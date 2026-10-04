package notify

import (
	"context"
	"errors"
	"fmt"
)

// Message is what a channel sender actually transmits. It is deliberately
// narrower than New: no account id, no dedupe key, no priority — a sender
// should not need to know anything about the outbox to send a message.
type Message struct {
	Title    string
	Body     string
	DeepLink string
	Data     map[string]any
	// IdempotencyKey is stable across retries of the same (notification,
	// channel) pair — it is notificationID+":"+channel. Real providers accept
	// this as a client reference / idempotency key so a retried River job
	// that actually landed upstream does not send twice.
	IdempotencyKey string
	// Email is the rendered email (subject, HTML and plain text) for the
	// EMAIL channel; nil on every other channel. The worker renders it from
	// the notification row just before sending (email.go).
	Email *RenderedEmail
}

// ErrChannelNotConfigured is returned by Notifier.Send for a channel with no
// registered sender.
var ErrChannelNotConfigured = errors.New("notify: no sender registered for channel")

// ChannelSender delivers a Message on one channel. target is channel-shaped:
// an E.164 phone for SMS, an Expo push token for PUSH, an email address for
// EMAIL. INAPP has no external sender — see Notifier.Send.
type ChannelSender interface {
	Send(ctx context.Context, target string, msg Message) (providerMessageID string, err error)
}

// SMSSender is the seam auth's phone-OTP path (P-02) sends through — the
// exact interface the brief calls out to generalize. Any ChannelSender can
// implement it; SMSAdapter turns one into the other so a single concrete type
// can serve both this package's channel plan and a caller that only wants to
// send an SMS directly (e.g. auth.SendOTP -> notify.SendOTP -> this).
type SMSSender interface {
	SendSMS(ctx context.Context, toE164 string, body string, idempotencyKey string) (providerMessageID string, err error)
}

// PushSender delivers to a device push token (Expo, per device.expo_push_token).
type PushSender interface {
	SendPush(ctx context.Context, expoPushToken string, msg Message) (providerMessageID string, err error)
}

// EmailSender delivers to an email address, honoring email_suppression at the
// provider-adapter level (a caller should check Repo/suppression before
// calling; the interface itself does not, so fakes stay simple).
type EmailSender interface {
	SendEmail(ctx context.Context, to string, msg Message) (providerMessageID string, err error)
}

// SMSAdapter adapts an SMSSender to ChannelSender.
type SMSAdapter struct{ SMSSender }

func (a SMSAdapter) Send(ctx context.Context, target string, msg Message) (string, error) {
	return a.SendSMS(ctx, target, msg.Body, msg.IdempotencyKey)
}

// PushAdapter adapts a PushSender to ChannelSender.
type PushAdapter struct{ PushSender }

func (a PushAdapter) Send(ctx context.Context, target string, msg Message) (string, error) {
	return a.SendPush(ctx, target, msg)
}

// EmailAdapter adapts an EmailSender to ChannelSender.
type EmailAdapter struct{ EmailSender }

func (a EmailAdapter) Send(ctx context.Context, target string, msg Message) (string, error) {
	return a.SendEmail(ctx, target, msg)
}

// Provider implements ProviderNamer when the wrapped sender does.
func (a EmailAdapter) Provider() string {
	if n, ok := a.EmailSender.(ProviderNamer); ok {
		return n.Provider()
	}
	return ""
}

// Notifier is the multi-channel dispatcher: one registered ChannelSender per
// Channel. It has no failover policy of its own — the worker walks a
// notification's channel plan and calls Send once per channel; Notifier's
// only job is "here is the sender for this channel, or ErrChannelNotConfigured".
type Notifier struct {
	senders map[Channel]ChannelSender
}

// NewNotifier returns an empty Notifier. Register channels with Register.
func NewNotifier() *Notifier {
	return &Notifier{senders: make(map[Channel]ChannelSender)}
}

// Register wires a sender for a channel, replacing any existing one. Returns
// the Notifier for chaining.
func (n *Notifier) Register(ch Channel, s ChannelSender) *Notifier {
	n.senders[ch] = s
	return n
}

// Configured reports whether a sender is registered for ch.
func (n *Notifier) Configured(ch Channel) bool {
	_, ok := n.senders[ch]
	return ok
}

// Provider names the provider registered for ch, or "" when it does not say.
func (n *Notifier) Provider(ch Channel) string {
	if p, ok := n.senders[ch].(ProviderNamer); ok {
		return p.Provider()
	}
	return ""
}

// Send dispatches to the registered sender for ch.
func (n *Notifier) Send(ctx context.Context, ch Channel, target string, msg Message) (string, error) {
	s, ok := n.senders[ch]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrChannelNotConfigured, ch)
	}
	return s.Send(ctx, target, msg)
}
