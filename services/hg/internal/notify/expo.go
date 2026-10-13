package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// ExpoSender delivers push notifications through the Expo Push API
// (https://docs.expo.dev/push-notifications/sending-notifications/). It is
// the PUSH channel only when HG_PUSH_ENABLED is on (cmd/hg/main.go); with it
// off, LogSender records every push SUPPRESSED, as before (issue #58).
//
// One notification goes to every live device of the account in one request
// (Expo takes up to 100 messages per request; more are split). Expo answers
// with one ticket per message, in order. A ticket that says
// DeviceNotRegistered means the app was uninstalled or the token is dead: the
// device is revoked through Revoke so it is never sent to again.
//
// Push tokens are never written to the log or into an error: an error from
// this sender is stored on notification_delivery and logged by the worker, so
// it carries Expo's error codes only, never Expo's message (which quotes the
// token).
//
// Expo's push receipts (the second, delayed check) are not read yet; the
// tickets catch a dead token on the next send instead.
type ExpoSender struct {
	// AccessToken is EXPO_ACCESS_TOKEN. Empty sends without one, which Expo
	// accepts unless the project has enhanced push security switched on.
	AccessToken string
	// BaseURL defaults to https://exp.host; tests point it at an httptest
	// server. No test ever reaches the real API.
	BaseURL string
	HTTP    *http.Client
	// Revoke turns off every live device holding token. Nil skips it. A
	// failure is logged and never fails the send.
	Revoke func(ctx context.Context, token string) error
	Log    *slog.Logger
}

// expoBatchSize is Expo's limit on messages per push request.
const expoBatchSize = 100

// expoTTLSeconds is how long Expo keeps trying to reach a phone that is off:
// a five-minute-old order update is no longer worth showing.
const expoTTLSeconds = 300

// Provider implements ProviderNamer.
func (*ExpoSender) Provider() string { return "expo" }

// Send implements ChannelSender for a single device.
func (e *ExpoSender) Send(ctx context.Context, token string, msg Message) (string, error) {
	return e.SendBatch(ctx, []string{token}, msg)
}

type expoMessage struct {
	To    string         `json:"to"`
	Title string         `json:"title,omitempty"`
	Body  string         `json:"body,omitempty"`
	Data  map[string]any `json:"data,omitempty"`
	Sound string         `json:"sound,omitempty"`
	// Priority is "high" or "default"; TTL is in seconds.
	Priority string `json:"priority"`
	TTL      int    `json:"ttl"`
}

type expoTicket struct {
	Status  string `json:"status"`
	ID      string `json:"id"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

// SendBatch implements BatchSender: one message to every token. It succeeds
// when at least one device accepted the message, and returns that ticket's id.
func (e *ExpoSender) SendBatch(ctx context.Context, tokens []string, msg Message) (string, error) {
	data := make(map[string]any, len(msg.Data)+1)
	for k, v := range msg.Data {
		data[k] = v
	}
	if msg.DeepLink != "" {
		data["deep_link"] = msg.DeepLink
	}
	if len(data) == 0 {
		data = nil
	}

	// HIGH and CRITICAL ring and wake the phone; the rest arrive quietly
	// (docs/spec/01-platform.md, "P-25 — Push notifications (Expo)").
	priority, sound := "default", ""
	if msg.Priority == PriorityHigh || msg.Priority == PriorityCritical {
		priority, sound = "high", "default"
	}

	var (
		firstID  string
		failures []error
		codes    []string
	)
	for start := 0; start < len(tokens); start += expoBatchSize {
		chunk := tokens[start:min(start+expoBatchSize, len(tokens))]
		msgs := make([]expoMessage, len(chunk))
		for i, t := range chunk {
			msgs[i] = expoMessage{To: t, Title: msg.Title, Body: msg.Body, Data: data,
				Sound: sound, Priority: priority, TTL: expoTTLSeconds}
		}
		tickets, err := e.post(ctx, msgs)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		for i, t := range tickets {
			if t.Status == "ok" {
				if firstID == "" {
					firstID = t.ID
					if firstID == "" {
						firstID = "unknown"
					}
				}
				continue
			}
			code := t.Details.Error
			if code == "" {
				code = "UnknownError"
			}
			codes = append(codes, code)
			if code == "DeviceNotRegistered" && i < len(chunk) {
				e.revoke(ctx, chunk[i])
			}
		}
	}
	if firstID != "" {
		return firstID, nil
	}
	if len(codes) > 0 {
		failures = append(failures, ticketError(codes))
	}
	if len(failures) == 0 {
		return "", Permanent(errors.New("notify: expo: no device to send to"))
	}
	return "", errors.Join(failures...)
}

// ticketError turns the ticket error codes of a send that reached no device
// into one error. Only a rate limit or bad credentials is worth retrying: the
// first passes, the second is fixed by the operator. A dead token, a message
// too big or a misconfigured app fails the same way every time.
func ticketError(codes []string) error {
	err := fmt.Errorf("notify: expo: no device accepted the push: %s", strings.Join(dedupe(codes), ", "))
	for _, c := range codes {
		if c == "MessageRateExceeded" || c == "InvalidCredentials" {
			return err
		}
	}
	return Permanent(err)
}

func dedupe(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := in[:0:0]
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// post sends one request of at most expoBatchSize messages and returns its
// tickets, in the order of msgs.
func (e *ExpoSender) post(ctx context.Context, msgs []expoMessage) ([]expoTicket, error) {
	body, err := json.Marshal(msgs)
	if err != nil {
		return nil, Permanent(fmt.Errorf("notify: expo: encode request: %w", err))
	}
	base := e.BaseURL
	if base == "" {
		base = "https://exp.host"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSuffix(base, "/")+"/--/api/v2/push/send", bytes.NewReader(body))
	if err != nil {
		return nil, Permanent(fmt.Errorf("notify: expo: build request: %w", err))
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "halalgoes-hg")
	if e.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+e.AccessToken)
	}
	client := e.HTTP
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("notify: expo: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var out struct {
		Data   []expoTicket `json:"data"`
		Errors []struct {
			Code string `json:"code"`
		} `json:"errors"`
	}
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || len(out.Errors) > 0 {
		codes := make([]string, 0, len(out.Errors))
		for _, x := range out.Errors {
			codes = append(codes, x.Code)
		}
		failure := fmt.Errorf("notify: expo: %d %s", resp.StatusCode, strings.Join(codes, ", "))
		switch {
		case resp.StatusCode == http.StatusTooManyRequests,
			resp.StatusCode >= 500,
			// A bad or missing access token is fixed by the operator: keep
			// retrying on River's backoff, as email does.
			resp.StatusCode == http.StatusUnauthorized,
			resp.StatusCode == http.StatusForbidden:
			return nil, failure
		default:
			return nil, Permanent(failure)
		}
	}
	if len(out.Data) != len(msgs) {
		// Expo took the request but the reply does not line up with it. Do
		// not retry into a second push to the devices it did accept.
		return []expoTicket{{Status: "ok", ID: "unknown"}}, nil
	}
	return out.Data, nil
}

func (e *ExpoSender) revoke(ctx context.Context, token string) {
	if e.Revoke == nil {
		return
	}
	// The send's context may be close to its deadline; a revoke is one
	// indexed update.
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := e.Revoke(rctx, token); err != nil {
		log := e.Log
		if log == nil {
			log = slog.Default()
		}
		log.WarnContext(ctx, "notify: expo: could not revoke an unregistered device", slog.String("error", err.Error()))
	}
}
