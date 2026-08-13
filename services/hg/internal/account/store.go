package account

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// errNotFound is the sentinel returned when a scoped query finds no matching
// row. It maps to 404 NOT_FOUND (IDOR: never 403) at the handler boundary.
var errNotFound = errors.New("not found")

func isNotFound(err error) bool { return errors.Is(err, errNotFound) }

// Repo is the account data-access layer. All queries are scoped to the
// caller's account_id (P-07 / IDOR ownership enforced in SQL).
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo creates a Repo backed by the given connection pool.
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

// UpdateCustomerProfile applies a partial update to the caller's customer_profile.
// Returns errNotFound when the row does not exist (IDOR: not 403).
// The update is scoped to account_id = callerID (P-07 ownership in SQL).
func (r *Repo) UpdateCustomerProfile(ctx context.Context, callerID string, in customerProfileUpdateInput) (customerProfileResponse, error) {
	// Build a dynamic SET clause only for non-nil fields.
	// We always bump updated_at and also handle marketing_consent_at (CASL).
	//
	// Strategy: update every provided field together with marketing_consent_at
	// when marketing_consent=true, then SELECT the full row back.
	type scanRow struct {
		AccountID          string
		FirstName          string
		LastName           *string
		MarketingConsentAt *time.Time
		CreatedAt          time.Time
		UpdatedAt          time.Time
		PhoneE164          *string
		EmailVerifiedAt    *time.Time
	}

	// We do it as a single UPDATE … RETURNING rather than UPDATE+SELECT so it is
	// one round-trip and avoids a TOCTOU window.
	//
	// Build CASE-based update: only overwrite a column when the caller supplies it.
	var row scanRow
	err := r.pool.QueryRow(ctx, `
		UPDATE customer_profile
		SET
			first_name           = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE first_name END,
			last_name            = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE last_name END,
			avatar_object_id     = CASE WHEN $4::uuid IS NOT NULL THEN $4::uuid ELSE avatar_object_id END,
			marketing_consent_at = CASE
			                         WHEN $5::boolean IS TRUE THEN COALESCE(marketing_consent_at, now())
			                         WHEN $5::boolean IS FALSE THEN NULL
			                         ELSE marketing_consent_at
			                       END,
			updated_at           = now()
		WHERE account_id = $1
		RETURNING
			account_id,
			first_name,
			last_name,
			marketing_consent_at,
			created_at,
			updated_at
	`,
		callerID,
		optStr(in.FirstName),
		optStr(in.LastName),
		optStr(in.AvatarObjectID),
		in.MarketingConsent,
	).Scan(
		&row.AccountID,
		&row.FirstName,
		&row.LastName,
		&row.MarketingConsentAt,
		&row.CreatedAt,
		&row.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return customerProfileResponse{}, errNotFound
	}
	if err != nil {
		return customerProfileResponse{}, err
	}

	// Fetch phone_e164 and email_verified_at from the account table.
	var phoneE164 *string
	var emailVerifiedAt *time.Time
	_ = r.pool.QueryRow(ctx,
		`SELECT phone_e164, email_verified_at FROM account WHERE id = $1`, callerID,
	).Scan(&phoneE164, &emailVerifiedAt)

	phone := ""
	if phoneE164 != nil {
		phone = *phoneE164
	}

	return customerProfileResponse{
		AccountID:        row.AccountID,
		FirstName:        row.FirstName,
		LastName:         row.LastName,
		AvatarURL:        nil, // presigned URL generation not wired yet
		PhoneE164:        phone,
		EmailVerified:    emailVerifiedAt != nil,
		MarketingConsent: row.MarketingConsentAt != nil,
		CreatedAt:        httpx.Timestamp(row.CreatedAt),
		UpdatedAt:        httpx.Timestamp(row.UpdatedAt),
	}, nil
}

// UpsertDevice registers or refreshes a push-notification device binding.
//
// Idempotency (P-25): (account_id, device_id) is the natural key; a second
// call with the same pair updates the token and bumps last_seen_at.
//
// Token rebind: if the same expo_push_token is live against a different
// account, that row is revoked first (I-25.1 / device_token_one_account).
func (r *Repo) UpsertDevice(ctx context.Context, callerID string, in deviceRegistrationInput) (deviceResponse, error) {
	roleCtx := normaliseRoleContext(in.RoleContext)
	locale := in.Locale
	if locale == "" {
		locale = "en-CA"
	}

	// Step 1: revoke any live binding of this token to a different account.
	_, err := r.pool.Exec(ctx, `
		UPDATE device
		SET    revoked_at = now()
		WHERE  expo_push_token = $1
		  AND  account_id <> $2
		  AND  revoked_at IS NULL
	`, in.ExpoPushToken, callerID)
	if err != nil {
		return deviceResponse{}, err
	}

	// Step 2: upsert on (account_id, device_id). The unique index
	// device_unique covers (account_id, device_id) WHERE revoked_at IS NULL.
	// We use INSERT … ON CONFLICT to handle both the create and the update
	// in a single statement.
	var resp deviceResponse
	err = r.pool.QueryRow(ctx, `
		INSERT INTO device
			(account_id, device_id, role_context, expo_push_token, platform,
			 app_version, os_version, locale, push_enabled, last_seen_at)
		VALUES
			($1, $2, $3, $4, $5::device_platform, $6, $7, $8, true, now())
		ON CONFLICT (account_id, device_id) WHERE revoked_at IS NULL DO UPDATE
			SET expo_push_token = EXCLUDED.expo_push_token,
			    role_context    = EXCLUDED.role_context,
			    platform        = EXCLUDED.platform,
			    app_version     = EXCLUDED.app_version,
			    os_version      = EXCLUDED.os_version,
			    locale          = EXCLUDED.locale,
			    push_enabled    = true,
			    last_seen_at    = now(),
			    updated_at      = now()
		RETURNING device_id, platform, role_context, push_enabled, last_seen_at
	`,
		callerID,
		in.DeviceID,
		roleCtx,
		in.ExpoPushToken,
		in.Platform,
		nilIfEmpty(in.AppVersion),
		nilIfEmpty(in.OsVersion),
		locale,
	).Scan(
		&resp.DeviceID,
		&resp.Platform,
		&resp.RoleContext,
		&resp.PushEnabled,
		new(time.Time),
	)
	if err != nil {
		return deviceResponse{}, err
	}

	// Re-query last_seen_at as a formatted timestamp.
	var lastSeen time.Time
	_ = r.pool.QueryRow(ctx,
		`SELECT last_seen_at FROM device WHERE account_id=$1 AND device_id=$2 AND revoked_at IS NULL`,
		callerID, in.DeviceID,
	).Scan(&lastSeen)
	resp.LastSeenAt = httpx.Timestamp(lastSeen)

	return resp, nil
}

// RevokeDevice sets revoked_at on the caller's device, scoped by both
// account_id and device_id. Returns errNotFound (→ 404) when no live row
// matches — this is the IDOR guard: a device owned by another account is
// indistinguishable from a non-existent one.
func (r *Repo) RevokeDevice(ctx context.Context, callerID, deviceID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE device
		SET    revoked_at = now()
		WHERE  account_id = $1
		  AND  device_id  = $2
		  AND  revoked_at IS NULL
	`, callerID, deviceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errNotFound
	}
	return nil
}

// ListNotifications returns the caller's inbox, newest-first, with keyset
// pagination. cursor is the last-seen notification id (empty = first page).
// unreadOnly filters to notifications where read_at IS NULL.
//
// The query fetches limit+1 rows; the extra row proves there are more pages
// without a separate COUNT query.
func (r *Repo) ListNotifications(
	ctx context.Context,
	callerID string,
	limit int,
	cursor string,
	unreadOnly bool,
) ([]notificationResponse, string, error) {
	// Build the query with a cursor predicate when one is provided.
	// Keyset: "rows created before the cursor row" (created_at DESC, id).
	var rows pgx.Rows
	var err error

	if cursor == "" && !unreadOnly {
		rows, err = r.pool.Query(ctx, `
			SELECT id, kind, title, body, priority, deep_link, read_at, created_at
			FROM   notification
			WHERE  account_id    = $1
			  AND  dismissed_at IS NULL
			ORDER  BY created_at DESC, id DESC
			LIMIT  $2
		`, callerID, limit+1)
	} else if cursor == "" && unreadOnly {
		rows, err = r.pool.Query(ctx, `
			SELECT id, kind, title, body, priority, deep_link, read_at, created_at
			FROM   notification
			WHERE  account_id    = $1
			  AND  dismissed_at IS NULL
			  AND  read_at      IS NULL
			ORDER  BY created_at DESC, id DESC
			LIMIT  $2
		`, callerID, limit+1)
	} else if cursor != "" && !unreadOnly {
		// cursor is the UUID of the last-seen notification.
		rows, err = r.pool.Query(ctx, `
			SELECT id, kind, title, body, priority, deep_link, read_at, created_at
			FROM   notification
			WHERE  account_id    = $1
			  AND  dismissed_at IS NULL
			  AND  (created_at, id) < (
			          SELECT created_at, id FROM notification WHERE id = $2 AND account_id = $1
			       )
			ORDER  BY created_at DESC, id DESC
			LIMIT  $3
		`, callerID, cursor, limit+1)
	} else {
		// cursor + unreadOnly
		rows, err = r.pool.Query(ctx, `
			SELECT id, kind, title, body, priority, deep_link, read_at, created_at
			FROM   notification
			WHERE  account_id    = $1
			  AND  dismissed_at IS NULL
			  AND  read_at      IS NULL
			  AND  (created_at, id) < (
			          SELECT created_at, id FROM notification WHERE id = $2 AND account_id = $1
			       )
			ORDER  BY created_at DESC, id DESC
			LIMIT  $3
		`, callerID, cursor, limit+1)
	}
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	var items []notificationResponse
	for rows.Next() {
		var n notificationResponse
		var readAt *time.Time
		var createdAt time.Time
		var deepLink *string
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.Priority, &deepLink, &readAt, &createdAt); err != nil {
			return nil, "", err
		}
		n.DeepLink = deepLink
		n.CreatedAt = httpx.Timestamp(createdAt)
		if readAt != nil {
			s := httpx.Timestamp(*readAt)
			n.ReadAt = &s
		}
		items = append(items, n)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}

	// Determine next cursor.
	nextCursor := ""
	if len(items) > limit {
		// There is at least one more page; the cursor is the id of the last
		// item on this page (the limit-th item, 0-indexed = items[limit-1]).
		nextCursor = items[limit-1].ID
		items = items[:limit]
	}

	if items == nil {
		items = []notificationResponse{}
	}

	return items, nextCursor, nil
}

// MarkNotificationRead sets read_at = now() WHERE id = notificationID AND
// account_id = callerID. Returns errNotFound (→ 404) when no row matches —
// the IDOR guard: another account's notification is indistinguishable from
// a non-existent one. Idempotent: marking an already-read notification is
// a no-op that returns 204.
func (r *Repo) MarkNotificationRead(ctx context.Context, callerID, notificationID string) error {
	// Use UPDATE … WHERE read_at IS NULL OR read_at IS NOT NULL so that an
	// already-read notification still matches (idempotency). The only way to
	// get 0 rows is an unknown id or a different account's id.
	tag, err := r.pool.Exec(ctx, `
		UPDATE notification
		SET    read_at    = COALESCE(read_at, now()),
		       updated_at = now()
		WHERE  id         = $1
		  AND  account_id = $2
	`, notificationID, callerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errNotFound
	}
	return nil
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// optStr returns nil when p is nil, otherwise a copy of *p.
func optStr(p *string) *string {
	if p == nil {
		return nil
	}
	s := *p
	return &s
}

// nilIfEmpty returns nil when s is the empty string.
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// normaliseRoleContext maps the contract's role_context value to the DB enum
// (role_context column in device: CUSTOMER | RESTAURANT | RIDER | ADMIN).
func normaliseRoleContext(rc string) string {
	switch rc {
	case "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "RESTAURANT_STAFF":
		return "RESTAURANT"
	case "CUSTOMER", "RIDER", "ADMIN":
		return rc
	default:
		return "CUSTOMER"
	}
}
