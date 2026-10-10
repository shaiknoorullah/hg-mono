package notify

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// TestExpoSenderBatchesAndRevokesUnregisteredDevices runs the Expo sender
// against a fake Expo endpoint: every device gets the push in batches of at
// most 100, the access token is sent, a DeviceNotRegistered ticket revokes
// that device, a send no device accepted is a failure the worker records, and
// no error ever quotes a push token.
func TestExpoSenderBatchesAndRevokesUnregisteredDevices(t *testing.T) {
	const dead = "ExponentPushToken[dead]"
	var (
		mu       sync.Mutex
		requests [][]expoMessage
		auth     []string
	)
	expo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/--/api/v2/push/send" {
			http.NotFound(w, r)
			return
		}
		var msgs []expoMessage
		if err := json.NewDecoder(r.Body).Decode(&msgs); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		mu.Lock()
		requests = append(requests, msgs)
		auth = append(auth, r.Header.Get("Authorization"))
		mu.Unlock()
		tickets := make([]map[string]any, len(msgs))
		for i, m := range msgs {
			if m.To == dead {
				tickets[i] = map[string]any{"status": "error",
					"message": fmt.Sprintf("%q is not a registered push notification recipient", m.To),
					"details": map[string]any{"error": "DeviceNotRegistered"}}
				continue
			}
			tickets[i] = map[string]any{"status": "ok", "id": fmt.Sprintf("ticket-%d", i)}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": tickets})
	}))
	defer expo.Close()

	var revoked []string
	sender := &ExpoSender{
		AccessToken: "test-access-token",
		BaseURL:     expo.URL,
		HTTP:        expo.Client(),
		Revoke: func(_ context.Context, token string) error {
			revoked = append(revoked, token)
			return nil
		},
	}
	ctx := context.Background()
	msg := Message{Title: "Order accepted", Body: "The kitchen is on it", DeepLink: "halalgoes://orders/1", Priority: PriorityHigh}

	// 150 devices, one of them dead: two requests (100 + 50), one revoke.
	tokens := make([]string, 150)
	for i := range tokens {
		tokens[i] = fmt.Sprintf("ExponentPushToken[%03d]", i)
	}
	tokens[120] = dead
	id, err := sender.SendBatch(ctx, tokens, msg)
	if err != nil || id != "ticket-0" {
		t.Fatalf("SendBatch = %q, %v; want the first ticket id and no error", id, err)
	}
	if len(requests) != 2 || len(requests[0]) != 100 || len(requests[1]) != 50 {
		t.Fatalf("requests = %d; want two batches of 100 and 50", len(requests))
	}
	first := requests[0][0]
	if first.Title != msg.Title || first.Body != msg.Body || first.Priority != "high" || first.Sound != "default" ||
		first.Data["deep_link"] != msg.DeepLink {
		t.Errorf("message = %+v; want the notification's title, body, deep link and high priority", first)
	}
	if auth[0] != "Bearer test-access-token" {
		t.Errorf("Authorization = %q; want the access token", auth[0])
	}
	if len(revoked) != 1 || revoked[0] != dead {
		t.Errorf("revoked = %v; want only the unregistered device", revoked)
	}

	// The only device is dead: nothing was sent, which is a permanent failure,
	// and the error names Expo's code but never the token.
	revoked = nil
	_, err = sender.Send(ctx, dead, msg)
	if err == nil || !IsPermanent(err) || !strings.Contains(err.Error(), "DeviceNotRegistered") {
		t.Fatalf("Send to a dead device = %v; want a permanent DeviceNotRegistered failure", err)
	}
	if strings.Contains(err.Error(), "ExponentPushToken") {
		t.Errorf("error %q quotes a push token", err)
	}
	if len(revoked) != 1 {
		t.Errorf("revoked = %v; want the dead device revoked", revoked)
	}

	// Expo is down: a failure River retries, never a permanent one.
	expo.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	if _, err := sender.Send(ctx, tokens[0], msg); err == nil || IsPermanent(err) {
		t.Errorf("Send while Expo is down = %v; want a retryable failure", err)
	}
}
