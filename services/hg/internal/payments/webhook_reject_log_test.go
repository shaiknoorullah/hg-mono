package payments

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stripe/stripe-go/v79/webhook"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// A rejected webhook leaves exactly one WARN line naming the reason and, when
// the body carries one, the event id — never the body or the signature header
// (#516).

const rejectBody = `{"id":"evt_1ReJected","object":"event","data":{"object":{"secret_field":"cus_SHOULD_NOT_LOG"}}}`
const rejectSig = "t=1700000000,v1=SIGVALUESHOULDNOTLOG"

func captureLog() (*slog.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	return slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})), &buf
}

func assertOneRejectLine(t *testing.T, buf *bytes.Buffer, reason string, wantID bool) string {
	t.Helper()
	out := strings.TrimSpace(buf.String())
	lines := strings.Split(out, "\n")
	if out == "" {
		t.Fatal("want one log line, got none")
	}
	if len(lines) != 1 {
		t.Fatalf("want exactly one log line, got %d:\n%s", len(lines), out)
	}
	line := lines[0]
	if !strings.Contains(line, "level=WARN") {
		t.Errorf("want WARN, got %s", line)
	}
	if !strings.Contains(line, "reason="+reason) && !strings.Contains(line, `reason="`+reason+`"`) {
		t.Errorf("want reason %q, got %s", reason, line)
	}
	if got := strings.Contains(line, "event_id=evt_1ReJected"); got != wantID {
		t.Errorf("event_id present = %v, want %v: %s", got, wantID, line)
	}
	for _, leak := range []string{"SIGVALUESHOULDNOTLOG", "cus_SHOULD_NOT_LOG", "secret_field"} {
		if strings.Contains(line, leak) {
			t.Errorf("log line leaks %q: %s", leak, line)
		}
	}
	t.Log(line)
	return line
}

func TestReceiveWebhook_BadSignatureLogsReason(t *testing.T) {
	log, buf := captureLog()
	mock := &mockStripe{VerifyWebhookFn: func(_ []byte, _ string) (StripeEvent, error) {
		return StripeEvent{}, errors.Join(errors.New("webhook signature verification failed"), webhook.ErrNoValidSignature)
	}}
	svc := NewService(nil, mock, config.Stripe{}, log)
	if _, err := svc.ReceiveWebhook(context.Background(), []byte(rejectBody), rejectSig, false); err == nil {
		t.Fatal("want rejection")
	}
	line := assertOneRejectLine(t, buf, "signature", true)
	if !strings.Contains(line, "no valid signature") {
		t.Errorf("want the signature failure kind in the line: %s", line)
	}
}

// An id that is not shaped like a Stripe event id is not logged: the body is
// unverified, so only a value that cannot carry anything else is.
func TestReceiveWebhook_BadSignatureSkipsMalformedID(t *testing.T) {
	log, buf := captureLog()
	mock := &mockStripe{VerifyWebhookFn: func(_ []byte, _ string) (StripeEvent, error) {
		return StripeEvent{}, webhook.ErrNotSigned
	}}
	svc := NewService(nil, mock, config.Stripe{}, log)
	_, _ = svc.ReceiveWebhook(context.Background(), []byte(`{"id":"evt_x\nlevel=ERROR cus_SHOULD_NOT_LOG"}`), "", false)
	assertOneRejectLine(t, buf, "signature", false)
}

func TestReceiveWebhook_LivemodeMismatchLogsReason(t *testing.T) {
	log, buf := captureLog()
	mock := &mockStripe{VerifyWebhookFn: func(_ []byte, _ string) (StripeEvent, error) {
		return StripeEvent{ID: "evt_1ReJected", Type: "payment_intent.succeeded", LiveMode: true}, nil
	}}
	svc := NewService(nil, mock, config.Stripe{}, log)
	if _, err := svc.ReceiveWebhook(context.Background(), []byte(rejectBody), rejectSig, false); err == nil {
		t.Fatal("want rejection")
	}
	assertOneRejectLine(t, buf, "livemode", true)
}

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errors.New("connection reset") }

func TestReceiveStripeWebhook_UnreadableBodyLogsReason(t *testing.T) {
	log, buf := captureLog()
	h := &Handler{svc: NewService(nil, &mockStripe{}, config.Stripe{}, log)}
	req := httptest.NewRequest(http.MethodPost, "/v1/webhooks/stripe", failingReader{})
	req.Header.Set("Stripe-Signature", rejectSig)
	rec := httptest.NewRecorder()
	h.ReceiveStripeWebhook(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
	assertOneRejectLine(t, buf, "unreadable body", false)
}
