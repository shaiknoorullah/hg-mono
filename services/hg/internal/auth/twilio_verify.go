package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// TwilioVerifyClient implements PhoneVerifier against the Twilio Verify API
// (https://verify.twilio.com/v2). Unlike TwilioSMSSender (Messages API, which
// only transports our code), Verify generates, sends AND validates the code:
//
//	Start:  POST /v2/Services/{VA}/Verifications      To=<e164>&Channel=<whatsapp|sms>  -> 201 status "pending"
//	Check:  POST /v2/Services/{VA}/VerificationChecks  To=<e164>&Code=<code>             -> 200 status "approved"|"pending"|"denied"
//
// Auth is HTTP Basic accountSID:authToken. It uses raw net/http (no SDK),
// mirroring TwilioSMSSender, and takes an injectable httpDoer so a unit test can
// assert the exact requests and drive approved/denied/error paths with no live
// credentials. It never logs or returns the code.
type TwilioVerifyClient struct {
	client     httpDoer
	accountSID string
	authToken  string
	serviceSID string // Verify Service SID, "VA..."
	channel    string // default channel when Start is called with an empty channel
	baseURL    string // overridable in tests; defaults to verify.twilio.com
}

// NewTwilioVerifyClient builds a Verify-backed PhoneVerifier. accountSID,
// authToken and serviceSID are required for Start/Check to succeed; channel is
// the default ("whatsapp" or "sms") used when Start receives an empty channel.
// client defaults to http.DefaultClient when nil.
func NewTwilioVerifyClient(client httpDoer, accountSID, authToken, serviceSID, channel string) *TwilioVerifyClient {
	if client == nil {
		client = http.DefaultClient
	}
	return &TwilioVerifyClient{
		client:     client,
		accountSID: accountSID,
		authToken:  authToken,
		serviceSID: serviceSID,
		channel:    channel,
		baseURL:    "https://verify.twilio.com",
	}
}

// twilioError is the shape Twilio returns on a non-2xx response.
type twilioError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Status  int    `json:"status"`
}

// verificationResponse is the (subset of the) 2xx body from both endpoints.
type verificationResponse struct {
	Status string `json:"status"`
}

// Start creates a verification: Twilio generates and delivers the code. It never
// logs the phone or a code. A non-2xx or transport failure is a wrapped error;
// the request-path caller swallows it so the response cannot leak enumeration.
func (t *TwilioVerifyClient) Start(ctx context.Context, phone, channel string) error {
	if err := t.requireCreds(); err != nil {
		return err
	}
	if channel == "" {
		channel = t.channel
	}
	if channel == "" {
		channel = "sms"
	}

	form := url.Values{}
	form.Set("To", phone)
	form.Set("Channel", channel)

	resp, body, err := t.post(ctx, "Verifications", form)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("twilio verify: start failed: %w", mapTwilioError(resp.StatusCode, body))
	}
	// A 2xx with an unexpected status is still a successful start (Twilio returns
	// "pending" here); we do not parse it beyond confirming the 2xx.
	return nil
}

// Check validates code for phone. See PhoneVerifier.Check for the return
// contract. It never logs the code.
func (t *TwilioVerifyClient) Check(ctx context.Context, phone, code string) (bool, error) {
	if err := t.requireCreds(); err != nil {
		return false, err
	}

	form := url.Values{}
	form.Set("To", phone)
	form.Set("Code", code)

	resp, body, err := t.post(ctx, "VerificationChecks", form)
	if err != nil {
		return false, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, mapTwilioError(resp.StatusCode, body)
	}
	var vr verificationResponse
	if err := json.Unmarshal(body, &vr); err != nil {
		return false, fmt.Errorf("twilio verify: decode check response: %w", err)
	}
	// "approved" is the only success; "pending"/"denied" (wrong code) are a
	// benign negative that the service reports as OTP_INCORRECT.
	return vr.Status == "approved", nil
}

// post issues one form-encoded, basic-authed POST to {base}/v2/Services/{VA}/{path}
// and returns the response plus its (bounded) body. The caller closes nothing —
// the body is fully read and closed here.
func (t *TwilioVerifyClient) post(ctx context.Context, path string, form url.Values) (*http.Response, []byte, error) {
	endpoint := fmt.Sprintf("%s/v2/Services/%s/%s", t.baseURL, t.serviceSID, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, nil, fmt.Errorf("twilio verify: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.SetBasicAuth(t.accountSID, t.authToken)

	resp, err := t.client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("twilio verify: request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return resp, body, nil
}

func (t *TwilioVerifyClient) requireCreds() error {
	if t.accountSID == "" || t.authToken == "" {
		return errors.New("twilio verify: account sid and auth token are required")
	}
	if t.serviceSID == "" {
		return errors.New("twilio verify: a verify service sid is required")
	}
	return nil
}

// mapTwilioError translates a non-2xx Twilio response into our domain error.
// The provider's "no live verification" family (max check attempts, not found,
// invalid parameter, rate limited) collapses to ErrVerifyNoPending — the
// enumeration-safe OTP_INVALID_OR_EXPIRED. Everything else stays a wrapped
// error the service surfaces as a generic internal failure. No code is ever
// included (the request never carried it into this branch's message).
func mapTwilioError(status int, body []byte) error {
	var te twilioError
	_ = json.Unmarshal(body, &te)
	switch te.Code {
	case 60200, // invalid parameter (e.g. malformed code)
		60202, // max check attempts reached
		60203, // max send attempts reached
		20404: // resource not found — no pending verification
		return ErrVerifyNoPending
	}
	if status == http.StatusTooManyRequests || status == http.StatusNotFound {
		return ErrVerifyNoPending
	}
	if te.Code != 0 {
		return fmt.Errorf("twilio verify: status %d, code %d", status, te.Code)
	}
	return fmt.Errorf("twilio verify: unexpected status %d", status)
}
