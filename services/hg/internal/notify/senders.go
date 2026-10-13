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

// ProviderNamer is implemented by senders that name their provider; the
// worker records the name in notification_delivery.provider.
type ProviderNamer interface {
	Provider() string
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

// ResendSender delivers email through Resend's HTTP API
// (https://resend.com/docs/api-reference/emails/send-email). Resend is the
// one approved hosted email provider (docs/decisions/README.md, "Settled —
// platform decisions", Email row).
//
// Every request carries the notification's idempotency key
// ("<notification id>:EMAIL"), which Resend honours for 24 hours: a job that
// sent the email but crashed before recording it re-sends the same request,
// and Resend answers with the original email id instead of mailing twice.
// Retries with backoff are River's (the outbox worker); this sender makes one
// attempt per call and says whether a failure is worth retrying.
type ResendSender struct {
	APIKey string
	// From is the sender, e.g. "HalalGoes <notifications@mail.halalgoes.com>".
	From    string
	ReplyTo string
	// BaseURL defaults to https://api.resend.com; tests point it at an
	// httptest server. No test ever reaches the real API.
	BaseURL string
	HTTP    *http.Client
}

// Provider implements ProviderNamer.
func (*ResendSender) Provider() string { return "resend" }

type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text"`
	ReplyTo string   `json:"reply_to,omitempty"`
}

// SendEmail implements EmailSender.
func (r *ResendSender) SendEmail(ctx context.Context, to string, msg Message) (string, error) {
	if msg.Email == nil {
		return "", Permanent(errors.New("notify: resend: message has no rendered email"))
	}
	// The worker already canonicalised the address; doing it again here means
	// no caller can hand Resend a list or a display name by mistake.
	to, err := CanonicalEmail(to)
	if err != nil {
		return "", Permanent(err)
	}
	body, err := json.Marshal(resendRequest{
		From: r.From, To: []string{to}, Subject: msg.Email.Subject,
		HTML: msg.Email.HTML, Text: msg.Email.Text, ReplyTo: r.ReplyTo,
	})
	if err != nil {
		return "", Permanent(fmt.Errorf("notify: resend: encode request: %w", err))
	}
	base := r.BaseURL
	if base == "" {
		base = "https://api.resend.com"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSuffix(base, "/")+"/emails", bytes.NewReader(body))
	if err != nil {
		return "", Permanent(fmt.Errorf("notify: resend: build request: %w", err))
	}
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "halalgoes-hg")
	if msg.IdempotencyKey != "" {
		req.Header.Set("Idempotency-Key", msg.IdempotencyKey)
	}

	client := r.HTTP
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		// Network trouble: the request may or may not have landed. Retrying
		// is safe because the idempotency key makes a second send a no-op.
		return "", fmt.Errorf("notify: resend: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		var ok struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &ok); err != nil || ok.ID == "" {
			// Resend accepted the email; only the reply is odd. Do not
			// retry into a second send.
			return "unknown", nil
		}
		return ok.ID, nil
	}

	var apiErr struct {
		Name    string `json:"name"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(raw, &apiErr)
	failure := fmt.Errorf("notify: resend: %d %s: %s", resp.StatusCode, apiErr.Name, truncate(apiErr.Message, 300))
	switch {
	case resp.StatusCode == http.StatusConflict && apiErr.Name == "concurrent_idempotent_requests":
		// The same email is being sent by another attempt right now.
		return "", failure
	case resp.StatusCode == http.StatusTooManyRequests,
		resp.StatusCode >= 500,
		// A bad or revoked key is fixed by the operator, not by giving up
		// on the email: keep retrying on River's backoff.
		resp.StatusCode == http.StatusUnauthorized,
		resp.StatusCode == http.StatusForbidden:
		return "", failure
	default:
		// 400/422 validation errors, and 409 invalid_idempotent_request (the
		// key was already used with a different payload): the same request
		// will fail the same way.
		return "", Permanent(failure)
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// ---------------------------------------------------------------------------
// Development guards: the log sender and the allow-list
// ---------------------------------------------------------------------------

// LogEmailSender is the email channel when no provider is configured (local
// and dev without a Resend key). It sends nothing: the delivery is recorded
// SUPPRESSED with reason NO_EMAIL_PROVIDER, and the message is written to the
// log. With Capture (never in production) the log line carries the subject and
// the plain-text body, links included, so a developer or the dev harness can
// follow a verification or reset link without a mailbox
// (issue #248: "a capture of outbound messages (local and dev only) shows it").
type LogEmailSender struct {
	Log     *slog.Logger
	Capture bool
}

// Provider implements ProviderNamer.
func (LogEmailSender) Provider() string { return "log" }

// SendEmail implements EmailSender.
func (l LogEmailSender) SendEmail(ctx context.Context, to string, msg Message) (string, error) {
	captureEmail(ctx, l.Log, l.Capture, "email not sent: no email provider configured", to, msg)
	return "", Suppressed("NO_EMAIL_PROVIDER")
}

// AllowListSender is the rule that dev never emails a real person (issue #235:
// the dev environment beside production uses test-mode integrations). Outside
// production every email passes through it: an address on the allow-list goes
// to Next (Resend); any other address is not sent, is recorded SUPPRESSED with
// reason NOT_ON_ALLOW_LIST, and is captured in the log instead. An empty list
// blocks everyone, so a dev environment given a real Resend key and no list
// still emails nobody.
type AllowListSender struct {
	Next    EmailSender
	Allow   AllowList
	Log     *slog.Logger
	Capture bool
}

// Provider implements ProviderNamer.
func (a AllowListSender) Provider() string {
	if n, ok := a.Next.(ProviderNamer); ok {
		return n.Provider()
	}
	return ""
}

// SendEmail implements EmailSender. The address is parsed once
// (CanonicalEmail), and that one canonical form is both checked against the
// list and handed to the provider, so no second parser can read it
// differently.
func (a AllowListSender) SendEmail(ctx context.Context, to string, msg Message) (string, error) {
	canonical, err := CanonicalEmail(to)
	if err != nil {
		return "", Permanent(err)
	}
	if !a.Allow.Permits(canonical) {
		captureEmail(ctx, a.Log, a.Capture, "email not sent: recipient is not on the non-production allow-list", canonical, msg)
		return "", Suppressed("NOT_ON_ALLOW_LIST")
	}
	return a.Next.SendEmail(ctx, canonical, msg)
}

func captureEmail(ctx context.Context, log *slog.Logger, capture bool, what, to string, msg Message) {
	if log == nil {
		log = slog.Default()
	}
	attrs := []any{slog.String("idempotency_key", msg.IdempotencyKey)}
	if capture {
		attrs = append(attrs, slog.String("to", to))
		if msg.Email != nil {
			attrs = append(attrs, slog.String("subject", msg.Email.Subject), slog.String("text", msg.Email.Text))
		}
	} else {
		attrs = append(attrs, slog.String("to", maskEmail(to)))
	}
	log.InfoContext(ctx, what, attrs...)
}

// maskEmail keeps the first character and the domain: "a•••@example.com".
func maskEmail(addr string) string {
	at := strings.LastIndexByte(addr, '@')
	if at <= 0 {
		return "•••"
	}
	return addr[:1] + "•••" + addr[at:]
}

// LogSender stands in for a channel whose provider is not wired yet (push
// until issue #58, notification SMS until the A2P registration in issue #59).
// It records the delivery SUPPRESSED with reason NO_PROVIDER and logs only
// metadata, never a body: an SMS body may hold a sign-in code
// (docs/spec/01-platform.md, "P-26 — SMS and email", rule I-26.1).
type LogSender struct {
	Channel Channel
	Log     *slog.Logger
}

// Provider implements ProviderNamer.
func (LogSender) Provider() string { return "log" }

// Send implements ChannelSender.
func (l LogSender) Send(ctx context.Context, _ string, msg Message) (string, error) {
	log := l.Log
	if log == nil {
		log = slog.Default()
	}
	log.DebugContext(ctx, "notification not sent: no provider for channel",
		slog.String("channel", string(l.Channel)), slog.String("idempotency_key", msg.IdempotencyKey))
	return "", Suppressed("NO_PROVIDER")
}
