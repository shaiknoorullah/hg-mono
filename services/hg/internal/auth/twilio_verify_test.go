package auth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"
)

// These tests drive TwilioVerifyClient with the mocked httpDoer (mockDoer, from
// sms_twilio_test.go): no live Verify service, no credentials — the outgoing
// *http.Request is inspected and a canned response returned. They assert the
// Verifications + VerificationChecks request shapes, basic auth, approved-vs-
// denied parsing, and the error-code → domain-error mapping.

func TestTwilioVerify_Start_RequestShape(t *testing.T) {
	m := &mockDoer{status: http.StatusCreated, respBody: `{"status":"pending"}`}
	c := NewTwilioVerifyClient(m, "ACxxxx", "authtoken", "VAyyyy", "whatsapp")

	if err := c.Start(context.Background(), "+15559876543", "whatsapp"); err != nil {
		t.Fatalf("Start: unexpected error: %v", err)
	}
	if m.gotReq == nil {
		t.Fatal("Start issued no HTTP request")
	}
	if m.gotReq.Method != http.MethodPost {
		t.Errorf("method = %s, want POST", m.gotReq.Method)
	}
	wantURL := "https://verify.twilio.com/v2/Services/VAyyyy/Verifications"
	if got := m.gotReq.URL.String(); got != wantURL {
		t.Errorf("url = %s, want %s", got, wantURL)
	}
	if u, p, ok := m.gotReq.BasicAuth(); !ok || u != "ACxxxx" || p != "authtoken" {
		t.Errorf("basic auth = (%s,%s,%v), want (ACxxxx,authtoken,true)", u, p, ok)
	}
	form, err := url.ParseQuery(m.gotBody)
	if err != nil {
		t.Fatalf("parse form body: %v", err)
	}
	if got := form.Get("To"); got != "+15559876543" {
		t.Errorf("To = %q, want +15559876543", got)
	}
	if got := form.Get("Channel"); got != "whatsapp" {
		t.Errorf("Channel = %q, want whatsapp", got)
	}
}

func TestTwilioVerify_Start_FallsBackToDefaultChannel(t *testing.T) {
	m := &mockDoer{status: http.StatusCreated, respBody: `{"status":"pending"}`}
	c := NewTwilioVerifyClient(m, "ACxxxx", "authtoken", "VAyyyy", "sms")

	if err := c.Start(context.Background(), "+15559876543", ""); err != nil {
		t.Fatalf("Start: unexpected error: %v", err)
	}
	form, _ := url.ParseQuery(m.gotBody)
	if got := form.Get("Channel"); got != "sms" {
		t.Errorf("Channel = %q, want sms (the client default when Start's channel is empty)", got)
	}
}

func TestTwilioVerify_Start_ErrorCodeMapsToNoPending(t *testing.T) {
	// 60203 = max send attempts reached.
	m := &mockDoer{status: http.StatusTooManyRequests, respBody: `{"code":60203,"message":"Max send attempts reached"}`}
	c := NewTwilioVerifyClient(m, "ACxxxx", "authtoken", "VAyyyy", "sms")

	err := c.Start(context.Background(), "+15559876543", "sms")
	if err == nil {
		t.Fatal("Start: expected an error on 429/60203")
	}
	if !errors.Is(err, ErrVerifyNoPending) {
		t.Errorf("Start error = %v, want it to wrap ErrVerifyNoPending", err)
	}
}

func TestTwilioVerify_Check_Approved(t *testing.T) {
	m := &mockDoer{status: http.StatusOK, respBody: `{"status":"approved"}`}
	c := NewTwilioVerifyClient(m, "ACxxxx", "authtoken", "VAyyyy", "sms")

	approved, err := c.Check(context.Background(), "+15559876543", "123456")
	if err != nil {
		t.Fatalf("Check: unexpected error: %v", err)
	}
	if !approved {
		t.Fatal("Check: approved = false, want true for status \"approved\"")
	}
	wantURL := "https://verify.twilio.com/v2/Services/VAyyyy/VerificationChecks"
	if got := m.gotReq.URL.String(); got != wantURL {
		t.Errorf("url = %s, want %s", got, wantURL)
	}
	if u, p, ok := m.gotReq.BasicAuth(); !ok || u != "ACxxxx" || p != "authtoken" {
		t.Errorf("basic auth = (%s,%s,%v), want (ACxxxx,authtoken,true)", u, p, ok)
	}
	form, err := url.ParseQuery(m.gotBody)
	if err != nil {
		t.Fatalf("parse form body: %v", err)
	}
	if got := form.Get("To"); got != "+15559876543" {
		t.Errorf("To = %q, want +15559876543", got)
	}
	if got := form.Get("Code"); got != "123456" {
		t.Errorf("Code = %q, want 123456", got)
	}
}

func TestTwilioVerify_Check_DeniedIsNotApproved(t *testing.T) {
	for _, status := range []string{"pending", "denied"} {
		m := &mockDoer{status: http.StatusOK, respBody: `{"status":"` + status + `"}`}
		c := NewTwilioVerifyClient(m, "ACxxxx", "authtoken", "VAyyyy", "sms")

		approved, err := c.Check(context.Background(), "+15559876543", "000000")
		if err != nil {
			t.Fatalf("Check(%s): unexpected error: %v", status, err)
		}
		if approved {
			t.Errorf("Check(%s): approved = true, want false", status)
		}
	}
}

func TestTwilioVerify_Check_ErrorCodesMapToNoPending(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
	}{
		{"max check attempts", http.StatusForbidden, `{"code":60202,"message":"Max check attempts reached"}`},
		{"not found", http.StatusNotFound, `{"code":20404,"message":"Not Found"}`},
		{"invalid parameter", http.StatusBadRequest, `{"code":60200,"message":"Invalid parameter"}`},
		{"rate limited no code", http.StatusTooManyRequests, `{"message":"Too Many Requests"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := &mockDoer{status: tc.status, respBody: tc.body}
			c := NewTwilioVerifyClient(m, "ACxxxx", "authtoken", "VAyyyy", "sms")

			approved, err := c.Check(context.Background(), "+15559876543", "123456")
			if approved {
				t.Error("approved = true, want false")
			}
			if !errors.Is(err, ErrVerifyNoPending) {
				t.Errorf("err = %v, want ErrVerifyNoPending", err)
			}
		})
	}
}

func TestTwilioVerify_Check_UnexpectedErrorIsNotNoPending(t *testing.T) {
	m := &mockDoer{status: http.StatusInternalServerError, respBody: `{"code":20500,"message":"Internal"}`}
	c := NewTwilioVerifyClient(m, "ACxxxx", "authtoken", "VAyyyy", "sms")

	_, err := c.Check(context.Background(), "+15559876543", "123456")
	if err == nil {
		t.Fatal("Check: expected an error on 500")
	}
	if errors.Is(err, ErrVerifyNoPending) {
		t.Error("500/20500 mapped to ErrVerifyNoPending; want a generic error")
	}
}

func TestTwilioVerify_TransportErrorIsWrapped(t *testing.T) {
	c := NewTwilioVerifyClient(&mockDoer{err: errTransport}, "ACxxxx", "authtoken", "VAyyyy", "sms")
	if _, err := c.Check(context.Background(), "+15559876543", "123456"); err == nil {
		t.Fatal("Check: expected a transport error")
	}
	if err := c.Start(context.Background(), "+15559876543", "sms"); err == nil {
		t.Fatal("Start: expected a transport error")
	}
}

func TestTwilioVerify_MissingCredentials(t *testing.T) {
	// No account creds.
	c := NewTwilioVerifyClient(&mockDoer{}, "", "", "VAyyyy", "sms")
	if err := c.Start(context.Background(), "+15559876543", "sms"); err == nil {
		t.Fatal("Start: expected an error with no account sid/auth token")
	}
	// No Verify service sid.
	c = NewTwilioVerifyClient(&mockDoer{}, "ACxxxx", "authtoken", "", "sms")
	if _, err := c.Check(context.Background(), "+15559876543", "123456"); err == nil {
		t.Fatal("Check: expected an error with no verify service sid")
	}
}
