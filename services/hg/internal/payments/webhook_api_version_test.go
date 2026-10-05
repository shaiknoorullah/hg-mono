package payments

import (
	"testing"
	"time"
)

// A webhook endpoint sends events in the API version it was created in, which
// is not stripe-go's. A correctly signed event in any version is accepted; the
// signature and its timestamp are still checked (#529).
func TestVerifyWebhookAcceptsAnyAPIVersionButStillChecksTheSignature(t *testing.T) {
	s := &liveStripe{webhookSecret: testWebhookSecret}
	body := []byte(`{"id":"evt_1Version","object":"event","api_version":"2026-03-25.dahlia","type":"payment_intent.amount_capturable_updated","created":1700000000,"livemode":false,"data":{"object":{"id":"pi_1Version"}}}`)

	ev, err := s.VerifyWebhook(body, signature(body, testWebhookSecret, time.Now()))
	if err != nil {
		t.Fatalf("a signed event in another API version was refused: %v", err)
	}
	if ev.ID != "evt_1Version" || ev.APIVersion != "2026-03-25.dahlia" || string(ev.DataObject) != `{"id":"pi_1Version"}` {
		t.Fatalf("event read wrong: id %q, version %q, object %s", ev.ID, ev.APIVersion, ev.DataObject)
	}

	if _, err := s.VerifyWebhook(body, signature(body, "whsec_not_this_endpoint", time.Now())); err == nil {
		t.Fatal("an event signed with another secret was accepted")
	}
	if _, err := s.VerifyWebhook(body, signature(body, testWebhookSecret, time.Now().Add(-time.Hour))); err == nil {
		t.Fatal("an event signed an hour ago was accepted")
	}
}
