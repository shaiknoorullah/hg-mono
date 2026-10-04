package notify

import (
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify/emailtmpl"
)

// EmailSpec is what a builder attaches to New for the EMAIL channel: which
// template to render (packages/emails, exported to emailtmpl) and the display
// values to fill it with. It is persisted in notification.data under
// emailDataKey, so a retried job renders the same email from the row rather
// than from a stale copy (worker.go), and so it must never hold a secret.
type EmailSpec struct {
	// Template is a name from emailtmpl's manifest, e.g. "password_reset".
	Template string `json:"template"`
	// Vars are the template's display values, already formatted: money from
	// integer cents (FormatCents), times in 12-hour form (FormatClock).
	Vars map[string]string `json:"vars,omitempty"`
	// LinkPath, when set, is the path on the recipient's web app the email's
	// button opens, e.g. "/reset-password". The renderer joins it to the
	// right base URL for the notification's role and, when the job carries
	// one, appends the single-use token, filling the template's ActionURL.
	LinkPath string `json:"link_path,omitempty"`
}

// emailDataKey is where EmailSpec lives inside notification.data. The
// contract's Notification has no data field, so nothing here reaches a client.
const emailDataKey = "email"

// genericTemplate renders a notification that has no template of its own
// from its inbox title and body (packages/emails/src/templates/generic.tsx).
const genericTemplate = "generic"

// RenderedEmail is one email ready for an EmailSender.
type RenderedEmail = emailtmpl.Rendered

// Links holds the base URL of each web app an email can link into. Riders and
// customers use the mobile apps, so their emails carry no button.
type Links struct {
	// Restaurant is the restaurant partner web app, e.g.
	// https://partners.halalgoes.com.
	Restaurant string
	// Admin is the admin web app, e.g. https://admin.halalgoes.com.
	Admin string
}

// URL builds the link for a role: the role's base URL, the path, and, when
// token is non-empty, ?token=<token>.
func (l Links) URL(role RoleContext, path, token string) (string, error) {
	var base string
	switch role {
	case RoleRestaurant:
		base = l.Restaurant
	case RoleAdmin:
		base = l.Admin
	}
	if base == "" {
		return "", fmt.Errorf("notify: no web app link configured for %s emails", role)
	}
	if !strings.HasPrefix(path, "/") {
		return "", fmt.Errorf("notify: email link path %q must start with /", path)
	}
	u, err := url.Parse(strings.TrimSuffix(base, "/") + path)
	if err != nil {
		return "", fmt.Errorf("notify: email link for %s: %w", role, err)
	}
	if token != "" {
		q := u.Query()
		q.Set("token", token)
		u.RawQuery = q.Encode()
	}
	return u.String(), nil
}

// EmailRenderer turns a persisted notification into an email.
type EmailRenderer struct {
	Templates *emailtmpl.Set
	Links     Links
}

// Render renders n's email. linkToken is the job's single-use token, if any.
// A notification without an EmailSpec renders the generic template from its
// title and body, so a kind whose template is not written yet still sends.
func (r *EmailRenderer) Render(n Notification, linkToken string) (RenderedEmail, error) {
	if r == nil || r.Templates == nil {
		return RenderedEmail{}, Permanent(errors.New("notify: no email templates loaded"))
	}
	spec, err := emailSpecFrom(n.Data)
	if err != nil {
		return RenderedEmail{}, Permanent(err)
	}
	if spec == nil {
		spec = &EmailSpec{Template: genericTemplate, Vars: map[string]string{"Title": n.Title, "Body": n.Body}}
	}
	vars := make(map[string]string, len(spec.Vars)+1)
	for k, v := range spec.Vars {
		vars[k] = v
	}
	if spec.LinkPath != "" {
		link, err := r.Links.URL(n.RoleContext, spec.LinkPath, linkToken)
		if err != nil {
			return RenderedEmail{}, Permanent(err)
		}
		vars["ActionURL"] = link
	} else if linkToken != "" {
		return RenderedEmail{}, Permanent(fmt.Errorf("notify: %s carries a link token but no link path", n.ID))
	}
	out, err := r.Templates.Render(spec.Template, vars)
	if err != nil {
		return RenderedEmail{}, Permanent(err)
	}
	return out, nil
}

// emailSpecFrom reads the EmailSpec back out of notification.data.
func emailSpecFrom(data map[string]any) (*EmailSpec, error) {
	raw, ok := data[emailDataKey]
	if !ok || raw == nil {
		return nil, nil
	}
	m, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("notify: notification.data.%s is %T, want an object", emailDataKey, raw)
	}
	spec := &EmailSpec{Vars: map[string]string{}}
	spec.Template, _ = m["template"].(string)
	spec.LinkPath, _ = m["link_path"].(string)
	if vars, ok := m["vars"].(map[string]any); ok {
		for k, v := range vars {
			s, ok := v.(string)
			if !ok {
				return nil, fmt.Errorf("notify: email var %s is %T, want a string", k, v)
			}
			spec.Vars[k] = s
		}
	}
	if spec.Template == "" {
		return nil, fmt.Errorf("notify: notification.data.%s has no template", emailDataKey)
	}
	return spec, nil
}

// withEmail returns a copy of data with spec stored under emailDataKey.
func withEmail(data map[string]any, spec *EmailSpec) map[string]any {
	out := make(map[string]any, len(data)+1)
	for k, v := range data {
		out[k] = v
	}
	if spec != nil {
		vars := make(map[string]any, len(spec.Vars))
		for k, v := range spec.Vars {
			vars[k] = v
		}
		e := map[string]any{"template": spec.Template, "vars": vars}
		if spec.LinkPath != "" {
			e["link_path"] = spec.LinkPath
		}
		out[emailDataKey] = e
	}
	return out
}

// SuppressedError is a deliberate non-send: the address is not on the
// non-production allow-list, the channel has no provider configured, or the
// recipient has no address for it. The worker records the delivery
// SUPPRESSED with Reason and moves on; it is not a failure and is never
// retried by itself.
type SuppressedError struct{ Reason string }

// Error implements error.
func (e *SuppressedError) Error() string { return "notify: suppressed: " + e.Reason }

// Suppressed returns a SuppressedError for reason (an UPPER_SNAKE code stored
// in notification_delivery.suppress_reason).
func Suppressed(reason string) error { return &SuppressedError{Reason: reason} }

// suppressedReason reports whether err is a suppression, and why.
func suppressedReason(err error) (string, bool) {
	var s *SuppressedError
	if errors.As(err, &s) {
		return s.Reason, true
	}
	return "", false
}

// PermanentError is a failure that retrying cannot fix: the provider rejected
// the address or the payload, or the template could not render. The worker
// records it FAILED and, when every failure in a job is permanent, cancels the
// job instead of retrying it twelve times.
type PermanentError struct{ Err error }

// Error implements error.
func (e *PermanentError) Error() string { return e.Err.Error() }

// Unwrap returns the underlying failure.
func (e *PermanentError) Unwrap() error { return e.Err }

// Permanent wraps err as a PermanentError.
func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return &PermanentError{Err: err}
}

// IsPermanent reports whether err, or anything it wraps, is permanent.
func IsPermanent(err error) bool {
	var p *PermanentError
	return errors.As(err, &p)
}
