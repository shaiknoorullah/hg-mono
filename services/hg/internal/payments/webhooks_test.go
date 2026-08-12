package payments

import (
	"context"
	"errors"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// A badly-signed webhook is a 400 and touches no row (I-17.2). The repo is nil
// here precisely to prove the failure path returns before any DB write.
func TestReceiveWebhook_BadSignatureNeverTouchesRepo(t *testing.T) {
	mock := &mockStripe{
		VerifyWebhookFn: func(_ []byte, _ string) (StripeEvent, error) {
			return StripeEvent{}, errors.New("bad signature")
		},
	}
	svc := NewService(nil, mock, config.Stripe{}, nil)
	_, err := svc.ReceiveWebhook(context.Background(), []byte(`{}`), "t=1,v1=deadbeef", false)
	var de *DomainError
	if !errors.As(err, &de) || de.Status != 400 {
		t.Fatalf("want 400 DomainError, got %v", err)
	}
}

// A verified event whose livemode disagrees with the environment is rejected
// (I-17.3), again before any DB write.
func TestReceiveWebhook_LivemodeMismatchRejected(t *testing.T) {
	mock := &mockStripe{
		VerifyWebhookFn: func(_ []byte, _ string) (StripeEvent, error) {
			return StripeEvent{ID: "evt_1", Type: "payment_intent.succeeded", LiveMode: true}, nil
		},
	}
	svc := NewService(nil, mock, config.Stripe{}, nil)
	// env is not live, event is live → reject.
	_, err := svc.ReceiveWebhook(context.Background(), []byte(`{}`), "sig", false)
	var de *DomainError
	if !errors.As(err, &de) || de.Status != 400 {
		t.Fatalf("want 400 DomainError for livemode mismatch, got %v", err)
	}
}

// ProcessStoredEvent parses a stored payload and dispatches by type. For an
// unhandled type it returns an "ignored" marker and no error, so the deadline
// runner marks it processed without retrying.
func TestProcessStoredEvent_UnhandledTypeIgnored(t *testing.T) {
	svc := NewService(nil, &mockStripe{}, config.Stripe{}, nil)
	payload := []byte(`{"id":"evt_x","type":"invoice.created","data":{"object":{}}}`)
	res, err := svc.ProcessStoredEvent(context.Background(), payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res != "ignored:invoice.created" {
		t.Fatalf("res = %q, want ignored:invoice.created", res)
	}
}
