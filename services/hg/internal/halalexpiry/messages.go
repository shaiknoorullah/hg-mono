package halalexpiry

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// Notification kinds this package writes. notification.kind is a plain string
// (contract Notification.kind), so new kinds need no migration.
const (
	KindCertificateExpiring notify.Kind = "HALAL_CERTIFICATE_EXPIRING"
	KindCertificateExpired  notify.Kind = "HALAL_CERTIFICATE_EXPIRED"
)

// The spec sends these messages by email and in-app
// (docs/spec/05-admin.md, "A-17 — Halal certificate expiry monitoring and lapse
// handling"); nothing here is urgent enough to wake anyone by SMS or push.
var messageChannels = []notify.Channel{notify.ChannelEmail, notify.ChannelInApp}

// reminderCert is the certificate a reminder is about.
type reminderCert struct {
	id             uuid.UUID
	expiresOn      time.Time
	today          time.Time // the restaurant's local date at the pass
	body           string
	restaurantName string
}

// reminderMessage is the renewal reminder for one owner or manager. The text
// quotes the certificate's own dates; it states no halal status and carries no
// colour (notify/doc.go, "Halal invariants that touch this package").
func reminderMessage(account, restaurantID uuid.UUID, c reminderCert, daysBefore, daysLeft int) notify.New {
	when := "in " + fmt.Sprint(daysLeft) + " days"
	switch daysLeft {
	case 0:
		when = "today"
	case 1:
		when = "tomorrow"
	}
	priority := notify.PriorityNormal
	if daysBefore <= 7 {
		priority = notify.PriorityHigh
	}
	return notify.New{
		AccountID:   account,
		RoleContext: notify.RoleRestaurant,
		Kind:        KindCertificateExpiring,
		Title:       "Halal certificate expires " + when,
		Body: fmt.Sprintf("Your halal certificate from %s expires on %s. Upload the renewed certificate "+
			"so %s stays listed: customers stop seeing it the day after the certificate expires.",
			c.body, dateText(c.expiresOn), c.restaurantName),
		Priority: priority,
		Channels: messageChannels,
		Data: map[string]any{
			"restaurant_id":  restaurantID.String(),
			"certificate_id": c.id.String(),
			"expires_on":     c.expiresOn.Format(time.DateOnly),
			"days_before":    daysBefore,
		},
		DedupeKey: fmt.Sprintf("halal_certificate_reminder:%s:%d", c.id, daysBefore),
		GroupKey:  "halal_certificate:" + c.id.String(),
	}
}

// expiredMessage tells one owner or manager that the certificate lapsed and
// the restaurant is no longer listed.
func expiredMessage(account, restaurantID uuid.UUID, lc lapsedCert) notify.New {
	return notify.New{
		AccountID:   account,
		RoleContext: notify.RoleRestaurant,
		Kind:        KindCertificateExpired,
		Title:       "Halal certificate expired",
		Body: fmt.Sprintf("Your halal certificate from %s expired on %s. %s is hidden from customers "+
			"until a renewed certificate is approved.", lc.body, dateText(lc.expiresOn), lc.restaurantName),
		Priority: notify.PriorityHigh,
		Channels: messageChannels,
		Data: map[string]any{
			"restaurant_id":  restaurantID.String(),
			"certificate_id": lc.id.String(),
			"expires_on":     lc.expiresOn.Format(time.DateOnly),
		},
		DedupeKey: "halal_certificate_expired:" + lc.id.String(),
		GroupKey:  "halal_certificate:" + lc.id.String(),
	}
}

// dateText is the date as the apps print it: "20 Oct 2026".
func dateText(d time.Time) string { return d.Format("2 Jan 2006") }
