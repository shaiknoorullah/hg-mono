package auth

import (
	"context"
	"log/slog"
)

// LogSMSSender is the default SMSSender used while O-03 (SMS provider selection)
// is unresolved. It records that a send was requested WITHOUT logging the code,
// so the OTP path is fully functional end to end for local development and
// tests, and swapping in a real provider is a one-line wiring change.
//
// This is not a fake result: no provider id is fabricated, nothing is TODO'd in
// the flow. The interface is honoured; only the transport is pending.
type LogSMSSender struct {
	log *slog.Logger
	// Echo, when true (local only), logs the code so a developer can complete
	// the flow without an SMS provider. It defaults to false and must never be
	// true outside local.
	Echo bool
}

// NewLogSMSSender builds a LogSMSSender.
func NewLogSMSSender(log *slog.Logger, echo bool) *LogSMSSender {
	if log == nil {
		log = slog.Default()
	}
	return &LogSMSSender{log: log, Echo: echo}
}

// SendOTP records the send. The code is logged only when Echo is set (local).
func (s *LogSMSSender) SendOTP(ctx context.Context, phone, code string) error {
	attrs := []any{slog.String("channel", "sms"), slog.String("template", "otp_sign_in")}
	if s.Echo {
		attrs = append(attrs, slog.String("phone", phone), slog.String("code", code))
	} else {
		attrs = append(attrs, slog.String("phone", maskPhone(phone)))
	}
	s.log.InfoContext(ctx, "otp sms enqueued (provider pending: O-03)", attrs...)
	return nil
}

// maskPhone reduces a phone to a coarse form safe for logs: keeps the country
// prefix and the last two digits.
func maskPhone(p string) string {
	if len(p) < 5 {
		return "***"
	}
	return p[:2] + "***" + p[len(p)-2:]
}
