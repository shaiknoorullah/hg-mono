package notify

import (
	"time"

	"github.com/google/uuid"
)

// Channel mirrors the contract's NotificationChannel enum exactly
// (contracts/openapi.yaml components.schemas.NotificationChannel).
type Channel string

const (
	ChannelRealtime Channel = "REALTIME"
	ChannelPush     Channel = "PUSH"
	ChannelSMS      Channel = "SMS"
	ChannelEmail    Channel = "EMAIL"
	ChannelInApp    Channel = "INAPP"
)

// Priority mirrors the contract's NotificationPriority enum.
type Priority string

const (
	PriorityCritical Priority = "CRITICAL"
	PriorityHigh     Priority = "HIGH"
	PriorityNormal   Priority = "NORMAL"
	PriorityLow      Priority = "LOW"
)

// RoleContext mirrors notification.role_context's CHECK constraint
// (services/hg/migrations/00020_notifications.sql).
type RoleContext string

const (
	RoleCustomer   RoleContext = "CUSTOMER"
	RoleRestaurant RoleContext = "RESTAURANT"
	RoleRider      RoleContext = "RIDER"
	RoleAdmin      RoleContext = "ADMIN"
)

// DeliveryState mirrors notification_delivery.state's CHECK constraint.
type DeliveryState string

const (
	DeliveryQueued     DeliveryState = "QUEUED"
	DeliverySent       DeliveryState = "SENT"
	DeliveryDelivered  DeliveryState = "DELIVERED"
	DeliveryAcked      DeliveryState = "ACKED"
	DeliveryFailed     DeliveryState = "FAILED"
	DeliverySuppressed DeliveryState = "SUPPRESSED"
)

// Kind identifies a row of the P-24 notification-router matrix. It is a plain
// string (not an enum) in both the contract (Notification.kind) and the
// schema (notification.kind), so new kinds never need a migration — only a
// new entry in the router table this package's callers build.
type Kind string

// Order-lifecycle kinds this package ships builders for (docs/spec/01-platform.md
// P-24). Callers may define their own Kind values for anything else; nothing
// here enumerates a closed set.
const (
	KindAuthOTP              Kind = "AUTH_OTP"
	KindOrderPlaced          Kind = "ORDER_PLACED"
	KindOrderAccepted        Kind = "ORDER_ACCEPTED"
	KindOrderRejected        Kind = "ORDER_REJECTED"
	KindOrderReady           Kind = "ORDER_READY"
	KindOrderPickupDelayed   Kind = "ORDER_PICKUP_DELAYED"
	KindOrderPickedUp        Kind = "ORDER_PICKED_UP"
	KindOrderDelivered       Kind = "ORDER_DELIVERED"
	KindOrderCancelled       Kind = "ORDER_CANCELLED"
	KindRiderAssigned        Kind = "RIDER_ASSIGNED"
	KindPaymentCaptureFailed Kind = "PAYMENT_CAPTURE_FAILED"
)

// New is the input to Enqueue: everything needed to write the notification
// row and schedule its delivery job, before any channel has been attempted.
//
// New carries no price and no halal state — see doc.go. Callers pass already-
// computed display strings; this package does not compute domain facts.
type New struct {
	AccountID   uuid.UUID
	RoleContext RoleContext
	Kind        Kind
	Title       string
	Body        string
	DeepLink    string // optional; empty means none
	Data        map[string]any
	Priority    Priority
	// Channels is the ordered failover plan: the worker tries them in this
	// order and stops at the first that succeeds, except REALTIME and INAPP,
	// which are never skipped for failover (INAPP is always attempted; it is
	// the system of record — see doc.go).
	Channels []Channel
	// DedupeKey, when non-empty, makes Enqueue idempotent for this account:
	// a second Enqueue with the same (AccountID, DedupeKey) is a no-op that
	// returns the existing notification's id and ok=false.
	DedupeKey string
	GroupKey  string
	OrderID   uuid.NullUUID
	// MustReach marks a notification that must escalate on a clock until it
	// lands or someone is alerted (schema: notification_must_reach_has_deadline).
	// When true, DeadlineAt must be set.
	MustReach  bool
	DeadlineAt time.Time
	AckWindow  time.Duration // defaults to 60s when zero
	// Overrides gives per-channel delivery targets and/or message bodies that
	// differ from Title/Body and from what the account/device lookup would
	// resolve. The motivating case is OTP: Body above is the redacted,
	// inbox-safe placeholder (contract: Notification.body never contains a
	// code); Overrides[SMS].Body is the real text with the real code, sent to
	// the provider but never written to the notification row. A channel with
	// no override resolves its target from AccountLookup and sends Title/Body
	// unchanged.
	Overrides map[Channel]ChannelOverride
	// Email names the template the EMAIL channel renders and the display
	// values it fills in (email.go). It is stored in notification.data, which
	// the contract never exposes, so it must hold nothing secret: a one-time
	// link token goes in Overrides[ChannelEmail].LinkToken instead. Nil means
	// the EMAIL channel, if planned, sends the generic template with Title and
	// Body.
	Email *EmailSpec
}

// ChannelOverride customises delivery for one channel of one notification
// without touching the persisted, contract-visible row. See New.Overrides.
type ChannelOverride struct {
	Target string `json:"target,omitempty"` // empty means "resolve from the account as usual"
	Body   string `json:"body,omitempty"`   // empty means "use the notification's own Body"
	// LinkToken is a single-use token (email verification, password reset,
	// staff invite) appended to the email's link as ?token=. Like an OTP code,
	// it travels only in the delivery job's arguments and to the provider,
	// never into notification.body or notification.data (docs/spec/01-platform.md,
	// "P-24 — Notification router", rule I-24.5: no notification body contains
	// a token).
	LinkToken string `json:"link_token,omitempty"`
}

// Notification is the persisted row (services/hg/migrations/00020_notifications.sql).
type Notification struct {
	ID          uuid.UUID
	AccountID   uuid.UUID
	RoleContext RoleContext
	Kind        Kind
	DedupeKey   string
	GroupKey    string
	Title       string
	Body        string
	DeepLink    string
	Data        map[string]any
	Priority    Priority
	MustReach   bool
	OrderID     uuid.NullUUID
	ReadAt      *time.Time
	DismissedAt *time.Time
	CreatedAt   time.Time
}

// Delivery is one row of notification_delivery: one channel attempt.
type Delivery struct {
	ID                int64
	NotificationID    uuid.UUID
	Channel           Channel
	Target            string
	Provider          string
	ProviderMessageID string
	State             DeliveryState
	SuppressReason    string
	Attempts          int
	ErrorCode         string
	ErrorMessage      string
	CostCents         *int64
	QueuedAt          time.Time
	SentAt            *time.Time
	SettledAt         *time.Time
}
