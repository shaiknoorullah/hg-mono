package auth

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// mockDoer is a mocked httpDoer: no live A2P registration, no network call —
// it inspects the outgoing *http.Request and returns a canned *http.Response.
type mockDoer struct {
	gotReq   *http.Request
	gotBody  string
	status   int
	respBody string
	err      error
}

func (m *mockDoer) Do(req *http.Request) (*http.Response, error) {
	if m.err != nil {
		return nil, m.err
	}
	m.gotReq = req
	if req.Body != nil {
		b, _ := io.ReadAll(req.Body)
		m.gotBody = string(b)
	}
	status := m.status
	if status == 0 {
		status = http.StatusCreated
	}
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(m.respBody)),
	}, nil
}

func TestTwilioSMSSender_SendOTP_Success(t *testing.T) {
	m := &mockDoer{status: http.StatusCreated, respBody: `{"sid":"SMxxxx","status":"queued"}`}
	s := NewTwilioSMSSender(m, "ACxxxx", "authtoken", "+15551234567")

	if err := s.SendOTP(context.Background(), "+15559876543", "123456"); err != nil {
		t.Fatalf("SendOTP: unexpected error: %v", err)
	}

	if m.gotReq == nil {
		t.Fatal("SendOTP did not issue an HTTP request")
	}
	if m.gotReq.Method != http.MethodPost {
		t.Errorf("method = %s, want POST", m.gotReq.Method)
	}
	wantURL := "https://api.twilio.com/2010-04-01/Accounts/ACxxxx/Messages.json"
	if m.gotReq.URL.String() != wantURL {
		t.Errorf("url = %s, want %s", m.gotReq.URL.String(), wantURL)
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
	if got := form.Get("From"); got != "+15551234567" {
		t.Errorf("From = %q, want +15551234567", got)
	}
	if !strings.Contains(form.Get("Body"), "123456") {
		t.Errorf("Body = %q, want it to contain the OTP code", form.Get("Body"))
	}
}

func TestTwilioSMSSender_SendOTP_UsesMessagingServiceSID(t *testing.T) {
	m := &mockDoer{status: http.StatusCreated}
	s := NewTwilioSMSSender(m, "ACxxxx", "authtoken", "")
	s.MessagingServiceSID = "MGxxxx"

	if err := s.SendOTP(context.Background(), "+15559876543", "123456"); err != nil {
		t.Fatalf("SendOTP: unexpected error: %v", err)
	}
	form, _ := url.ParseQuery(m.gotBody)
	if got := form.Get("MessagingServiceSid"); got != "MGxxxx" {
		t.Errorf("MessagingServiceSid = %q, want MGxxxx", got)
	}
	if got := form.Get("From"); got != "" {
		t.Errorf("From = %q, want empty when MessagingServiceSID is set", got)
	}
}

func TestTwilioSMSSender_SendOTP_NonOKStatusIsError(t *testing.T) {
	m := &mockDoer{status: http.StatusUnauthorized, respBody: `{"code":20003,"message":"Authenticate"}`}
	s := NewTwilioSMSSender(m, "ACxxxx", "authtoken", "+15551234567")

	err := s.SendOTP(context.Background(), "+15559876543", "123456")
	if err == nil {
		t.Fatal("SendOTP: expected error on 401, got nil")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error = %v, want it to mention status 401", err)
	}
}

func TestTwilioSMSSender_SendOTP_TransportErrorIsWrapped(t *testing.T) {
	m := &mockDoer{err: errTransport}
	s := NewTwilioSMSSender(m, "ACxxxx", "authtoken", "+15551234567")

	err := s.SendOTP(context.Background(), "+15559876543", "123456")
	if err == nil {
		t.Fatal("SendOTP: expected error on transport failure, got nil")
	}
}

func TestTwilioSMSSender_SendOTP_MissingCredentials(t *testing.T) {
	s := NewTwilioSMSSender(&mockDoer{}, "", "", "+15551234567")
	if err := s.SendOTP(context.Background(), "+15559876543", "123456"); err == nil {
		t.Fatal("SendOTP: expected error with no account sid/auth token, got nil")
	}
}

func TestTwilioSMSSender_SendOTP_MissingFromAndMessagingService(t *testing.T) {
	s := NewTwilioSMSSender(&mockDoer{}, "ACxxxx", "authtoken", "")
	if err := s.SendOTP(context.Background(), "+15559876543", "123456"); err == nil {
		t.Fatal("SendOTP: expected error with neither From nor MessagingServiceSID, got nil")
	}
}

// errTransport is a stand-in transport failure (network down, DNS failure, …).
type transportError struct{}

func (transportError) Error() string { return "mock transport failure" }

var errTransport = transportError{}
