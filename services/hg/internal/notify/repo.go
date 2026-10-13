package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DB is the subset of *pgxpool.Pool and pgx.Tx this package needs. Every
// repository method takes one explicitly rather than holding a pool, which is
// what makes InsertNotification callable inside the caller's business
// transaction (doc.go's central guarantee) as well as standalone.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Repo is the Postgres persistence for notification, notification_delivery
// and the inbox read path. It holds no connection of its own — see DB.
type Repo struct{}

// NewRepo constructs a Repo. It is stateless; the zero value works too.
func NewRepo() *Repo { return &Repo{} }

// ErrDuplicate is returned by InsertNotification when a row with the same
// (account_id, dedupe_key) already exists — the idempotent-enqueue path.
var ErrDuplicate = errors.New("notify: duplicate dedupe_key for account")

// InsertNotification writes the notification row. When n.DedupeKey is set and
// a row already exists for (AccountID, DedupeKey), it returns the *existing*
// row's id and ok=false instead of erroring — the caller (Enqueue) uses this
// to skip re-scheduling a job for a message that was already queued.
func (r *Repo) InsertNotification(ctx context.Context, db DB, n New) (id uuid.UUID, ok bool, err error) {
	dataJSON, err := marshalData(withEmail(n.Data, n.Email))
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("notify: marshal data: %w", err)
	}
	ackWindow := n.AckWindow
	if ackWindow <= 0 {
		ackWindow = 60 * time.Second
	}

	var dedupe, groupKey, deepLink any
	if n.DedupeKey != "" {
		dedupe = n.DedupeKey
	}
	if n.GroupKey != "" {
		groupKey = n.GroupKey
	}
	if n.DeepLink != "" {
		deepLink = n.DeepLink
	}
	var deadline any
	if !n.DeadlineAt.IsZero() {
		deadline = n.DeadlineAt
	}
	var orderID any
	if n.OrderID.Valid {
		orderID = n.OrderID.UUID
	}

	const q = `
		INSERT INTO notification (
			account_id, role_context, kind, dedupe_key, group_key, title, body,
			deep_link, data, priority, must_reach, ack_window_s, order_id, deadline_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		ON CONFLICT (account_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
		RETURNING id`

	row := db.QueryRow(ctx, q,
		n.AccountID, string(n.RoleContext), string(n.Kind), dedupe, groupKey,
		n.Title, n.Body, deepLink, dataJSON, string(n.Priority), n.MustReach,
		int(ackWindow.Seconds()), orderID, deadline,
	)
	if scanErr := row.Scan(&id); scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			// ON CONFLICT DO NOTHING skipped the insert: a row for this
			// dedupe_key already exists. Look it up so the caller still gets
			// an id to hand to the (already-enqueued) job.
			existing, lookupErr := r.findByDedupe(ctx, db, n.AccountID, n.DedupeKey)
			if lookupErr != nil {
				return uuid.Nil, false, lookupErr
			}
			return existing, false, nil
		}
		return uuid.Nil, false, fmt.Errorf("notify: insert notification: %w", scanErr)
	}
	return id, true, nil
}

func (r *Repo) findByDedupe(ctx context.Context, db DB, accountID uuid.UUID, dedupeKey string) (uuid.UUID, error) {
	var id uuid.UUID
	err := db.QueryRow(ctx,
		`SELECT id FROM notification WHERE account_id = $1 AND dedupe_key = $2`,
		accountID, dedupeKey,
	).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("notify: find by dedupe key: %w", err)
	}
	return id, nil
}

// GetNotification loads a notification row by id.
func (r *Repo) GetNotification(ctx context.Context, db DB, id uuid.UUID) (Notification, error) {
	const q = `
		SELECT id, account_id, role_context, kind, COALESCE(dedupe_key, ''), COALESCE(group_key, ''),
		       title, body, COALESCE(deep_link, ''), data, priority, must_reach, order_id,
		       read_at, dismissed_at, created_at
		FROM notification WHERE id = $1`
	var n Notification
	var dataRaw []byte
	var roleCtx, kind, priority string
	var orderID uuid.NullUUID
	err := db.QueryRow(ctx, q, id).Scan(
		&n.ID, &n.AccountID, &roleCtx, &kind, &n.DedupeKey, &n.GroupKey,
		&n.Title, &n.Body, &n.DeepLink, &dataRaw, &priority, &n.MustReach, &orderID,
		&n.ReadAt, &n.DismissedAt, &n.CreatedAt,
	)
	if err != nil {
		return Notification{}, fmt.Errorf("notify: get notification %s: %w", id, err)
	}
	n.RoleContext = RoleContext(roleCtx)
	n.Kind = Kind(kind)
	n.Priority = Priority(priority)
	n.OrderID = orderID
	if len(dataRaw) > 0 {
		if err := json.Unmarshal(dataRaw, &n.Data); err != nil {
			return Notification{}, fmt.Errorf("notify: unmarshal data for %s: %w", id, err)
		}
	}
	return n, nil
}

// ListInbox is the non-destructive read behind GET /v1/notifications: reading
// never deletes or mutates a row (doc.go / P-24).
func (r *Repo) ListInbox(ctx context.Context, db DB, accountID uuid.UUID, unreadOnly bool, limit int, before time.Time) ([]Notification, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `
		SELECT id, account_id, role_context, kind, COALESCE(dedupe_key, ''), COALESCE(group_key, ''),
		       title, body, COALESCE(deep_link, ''), data, priority, must_reach, order_id,
		       read_at, dismissed_at, created_at
		FROM notification
		WHERE account_id = $1 AND dismissed_at IS NULL`
	args := []any{accountID}
	if unreadOnly {
		q += ` AND read_at IS NULL`
	}
	if !before.IsZero() {
		args = append(args, before)
		q += fmt.Sprintf(` AND created_at < $%d`, len(args))
	}
	args = append(args, limit)
	q += fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d`, len(args))

	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("notify: list inbox: %w", err)
	}
	defer rows.Close()

	var out []Notification
	for rows.Next() {
		var n Notification
		var dataRaw []byte
		var roleCtx, kind, priority string
		var orderID uuid.NullUUID
		if err := rows.Scan(
			&n.ID, &n.AccountID, &roleCtx, &kind, &n.DedupeKey, &n.GroupKey,
			&n.Title, &n.Body, &n.DeepLink, &dataRaw, &priority, &n.MustReach, &orderID,
			&n.ReadAt, &n.DismissedAt, &n.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("notify: scan inbox row: %w", err)
		}
		n.RoleContext = RoleContext(roleCtx)
		n.Kind = Kind(kind)
		n.Priority = Priority(priority)
		n.OrderID = orderID
		if len(dataRaw) > 0 {
			_ = json.Unmarshal(dataRaw, &n.Data)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// MarkRead sets read_at once, idempotently (a second call is a no-op, not an
// error) and only for the owning account — callers must have already proven
// ownership of accountID (P-07); this method still filters by it as a second
// line of defence.
func (r *Repo) MarkRead(ctx context.Context, db DB, accountID, notificationID uuid.UUID) (found bool, err error) {
	tag, err := db.Exec(ctx,
		`UPDATE notification SET read_at = now()
		 WHERE id = $1 AND account_id = $2 AND read_at IS NULL`,
		notificationID, accountID)
	if err != nil {
		return false, fmt.Errorf("notify: mark read: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return true, nil
	}
	// RowsAffected is 0 both when the row doesn't exist/belong to this account
	// and when it was already read. Distinguish so the caller can 404 vs 204.
	var exists bool
	err = db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM notification WHERE id = $1 AND account_id = $2)`,
		notificationID, accountID,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("notify: mark read existence check: %w", err)
	}
	return exists, nil
}

// InsertDelivery records one channel attempt (state QUEUED) and returns its id.
func (r *Repo) InsertDelivery(ctx context.Context, db DB, d Delivery) (int64, error) {
	const q = `
		INSERT INTO notification_delivery (notification_id, channel, target, provider, attempts)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id`
	var id int64
	err := db.QueryRow(ctx, q, d.NotificationID, string(d.Channel), d.Target, nullIfEmpty(d.Provider), d.Attempts).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("notify: insert delivery: %w", err)
	}
	return id, nil
}

// SettleDelivery moves a delivery row to a terminal or retry-visible state
// after a provider call. attempts is the running attempt count for that
// channel (at-least-once: River retries the job, this package retries the
// channel row it owns).
func (r *Repo) SettleDelivery(ctx context.Context, db DB, id int64, state DeliveryState, providerMessageID, errCode, errMsg string, attempts int) error {
	_, err := db.Exec(ctx, `
		UPDATE notification_delivery
		SET state = $2, provider_message_id = $3, error_code = $4, error_message = $5,
		    attempts = $6, sent_at = CASE WHEN $2 IN ('SENT','DELIVERED','ACKED') THEN now() ELSE sent_at END,
		    settled_at = CASE WHEN $2 IN ('DELIVERED','ACKED','FAILED','SUPPRESSED') THEN now() ELSE settled_at END
		WHERE id = $1`,
		id, string(state), nullIfEmpty(providerMessageID), nullIfEmpty(errCode), nullIfEmpty(errMsg), attempts)
	if err != nil {
		return fmt.Errorf("notify: settle delivery %d: %w", id, err)
	}
	return nil
}

// SuppressDelivery records a deliberate non-send on a delivery row: no
// provider, no address, or an address the non-production allow-list blocks.
// reason goes in suppress_reason (an UPPER_SNAKE code, see SuppressedError).
func (r *Repo) SuppressDelivery(ctx context.Context, db DB, id int64, reason string, attempts int) error {
	_, err := db.Exec(ctx, `
		UPDATE notification_delivery
		SET state = 'SUPPRESSED', suppress_reason = $2, attempts = $3, settled_at = now()
		WHERE id = $1`, id, reason, attempts)
	if err != nil {
		return fmt.Errorf("notify: suppress delivery %d: %w", id, err)
	}
	return nil
}

// ClaimLease takes the notification's delivery lease (notification.lease_until
// and lease_owner) for ttl, or reports false when another worker holds an
// unexpired one. River runs a job on one worker at a time, but a job it
// rescues as stuck can run beside the original; the lease keeps those two
// from both sending the same email.
func (r *Repo) ClaimLease(ctx context.Context, db DB, id uuid.UUID, owner string, ttl time.Duration) (bool, error) {
	tag, err := db.Exec(ctx, `
		UPDATE notification
		SET lease_owner = $2, lease_until = now() + $3::interval
		WHERE id = $1 AND (lease_until IS NULL OR lease_until < now() OR lease_owner = $2)`,
		id, owner, ttl.String())
	if err != nil {
		return false, fmt.Errorf("notify: claim lease on %s: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

// ReleaseLease gives the lease back, if owner still holds it.
func (r *Repo) ReleaseLease(ctx context.Context, db DB, id uuid.UUID, owner string) error {
	_, err := db.Exec(ctx, `
		UPDATE notification SET lease_owner = NULL, lease_until = NULL
		WHERE id = $1 AND lease_owner = $2`, id, owner)
	if err != nil {
		return fmt.Errorf("notify: release lease on %s: %w", id, err)
	}
	return nil
}

// ListDeliveries returns every attempt recorded for a notification, oldest
// first — used by the worker to decide which channels already succeeded on a
// retried job (idempotent delivery: don't re-SMS a channel that already sent).
func (r *Repo) ListDeliveries(ctx context.Context, db DB, notificationID uuid.UUID) ([]Delivery, error) {
	rows, err := db.Query(ctx, `
		SELECT id, notification_id, channel, target, COALESCE(provider, ''), COALESCE(provider_message_id, ''),
		       state, COALESCE(suppress_reason, ''), attempts, COALESCE(error_code, ''), COALESCE(error_message, ''),
		       queued_at, sent_at, settled_at
		FROM notification_delivery WHERE notification_id = $1 ORDER BY id`, notificationID)
	if err != nil {
		return nil, fmt.Errorf("notify: list deliveries: %w", err)
	}
	defer rows.Close()
	var out []Delivery
	for rows.Next() {
		var d Delivery
		var channel, state string
		if err := rows.Scan(&d.ID, &d.NotificationID, &channel, &d.Target, &d.Provider, &d.ProviderMessageID,
			&state, &d.SuppressReason, &d.Attempts, &d.ErrorCode, &d.ErrorMessage,
			&d.QueuedAt, &d.SentAt, &d.SettledAt); err != nil {
			return nil, fmt.Errorf("notify: scan delivery: %w", err)
		}
		d.Channel = Channel(channel)
		d.State = DeliveryState(state)
		out = append(out, d)
	}
	return out, rows.Err()
}

func marshalData(m map[string]any) ([]byte, error) {
	if m == nil {
		m = map[string]any{}
	}
	return json.Marshal(m)
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
