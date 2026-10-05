package account

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// errNotFound is the sentinel returned when a scoped query finds no matching
// row. It maps to 404 NOT_FOUND (IDOR: never 403) at the handler boundary.
var errNotFound = errors.New("not found")

// errEmailInUse is returned when a profile email change collides with another
// account's email (account.email is UNIQUE). It maps to 422 EMAIL_IN_USE.
var errEmailInUse = errors.New("email in use")

// errUploadNotFound is returned when avatar_object_id names a file the caller
// may not use: no such upload, or one that is not the caller's own confirmed
// AVATAR upload. All of these are one 404, so the answer says nothing about
// whether the file exists (https://github.com/shaiknoorullah/hg-mono/issues/359).
var errUploadNotFound = errors.New("upload not found")

func isNotFound(err error) bool       { return errors.Is(err, errNotFound) }
func isEmailInUse(err error) bool     { return errors.Is(err, errEmailInUse) }
func isUploadNotFound(err error) bool { return errors.Is(err, errUploadNotFound) }

// pgUniqueViolation is the SQLSTATE for a unique-constraint violation (23505).
const pgUniqueViolation = "23505"

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
		DefaultAddressID   *string
		MarketingConsentAt *time.Time
		CreatedAt          time.Time
	}

	// The profile update and any email change on the account row must be one
	// atomic unit: a half-applied profile is a partial write.
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return customerProfileResponse{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after Commit is a no-op

	// An avatar must be the caller's own confirmed avatar upload: never another
	// account's file, and never a document or a delivery photo
	// (https://github.com/shaiknoorullah/hg-mono/issues/359).
	if in.AvatarObjectID != nil {
		var usable bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
			  SELECT 1 FROM stored_object
			   WHERE id = $1 AND uploaded_by = $2
			     AND purpose = 'AVATAR' AND state = 'READY' AND deleted_at IS NULL)`,
			*in.AvatarObjectID, callerID).Scan(&usable); err != nil {
			return customerProfileResponse{}, err
		}
		if !usable {
			return customerProfileResponse{}, errUploadNotFound
		}
	}

	// Single UPDATE … RETURNING, scoped to the caller AND to a live (not
	// soft-deleted) row. A CASE-based SET overwrites a column only when the
	// caller supplied it; a soft-deleted profile matches no row → errNotFound.
	var row scanRow
	err = tx.QueryRow(ctx, `
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
		  AND deleted_at IS NULL
		RETURNING
			account_id,
			first_name,
			last_name,
			default_address_id,
			marketing_consent_at,
			created_at
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
		&row.DefaultAddressID,
		&row.MarketingConsentAt,
		&row.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return customerProfileResponse{}, errNotFound
	}
	if err != nil {
		return customerProfileResponse{}, err
	}

	// Email change (C-03): setting email resets email_verified (email_verified_at
	// → NULL) so a fresh verification is required. Only the caller's OWN, live
	// account row is touched. A collision with another account's email is a
	// clean EMAIL_IN_USE, never a bare 500.
	if in.Email != nil {
		tag, uErr := tx.Exec(ctx, `
			UPDATE account
			SET    email = $2::citext,
			       email_verified_at = NULL,
			       updated_at = now()
			WHERE  id = $1
			  AND  deleted_at IS NULL
		`, callerID, *in.Email)
		if uErr != nil {
			var pgErr *pgconn.PgError
			if errors.As(uErr, &pgErr) && pgErr.Code == pgUniqueViolation {
				return customerProfileResponse{}, errEmailInUse
			}
			return customerProfileResponse{}, uErr
		}
		if tag.RowsAffected() == 0 {
			return customerProfileResponse{}, errNotFound
		}
	}

	// Read back phone_e164, email and email_verified_at from the (same-tx)
	// account row so the response reflects the just-applied email change.
	var phoneE164 *string
	var email *string
	var emailVerifiedAt *time.Time
	if err = tx.QueryRow(ctx,
		`SELECT phone_e164, email::text, email_verified_at FROM account WHERE id = $1`, callerID,
	).Scan(&phoneE164, &email, &emailVerifiedAt); err != nil {
		return customerProfileResponse{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return customerProfileResponse{}, err
	}

	phone := ""
	if phoneE164 != nil {
		phone = *phoneE164
	}

	var consentAt *string
	if row.MarketingConsentAt != nil {
		s := httpx.Timestamp(*row.MarketingConsentAt)
		consentAt = &s
	}

	return customerProfileResponse{
		AccountID:          row.AccountID,
		FirstName:          row.FirstName,
		LastName:           row.LastName,
		Email:              email,
		EmailVerified:      emailVerifiedAt != nil,
		PhoneE164:          phone,
		AvatarURL:          nil, // presigned URL generation not wired yet
		DefaultAddressID:   row.DefaultAddressID,
		MarketingConsentAt: consentAt,
		CreatedAt:          httpx.Timestamp(row.CreatedAt),
	}, nil
}

// GetCustomerProfile reads the caller's customer_profile joined to the account
// row (for phone_e164, email, email_verified). Returns errNotFound (→ 404) when
// no live row exists — the profile is scoped to account_id = callerID (P-07).
func (r *Repo) GetCustomerProfile(ctx context.Context, callerID string) (customerProfileResponse, error) {
	var (
		accountID          string
		firstName          string
		lastName           *string
		defaultAddressID   *string
		marketingConsentAt *time.Time
		createdAt          time.Time
		phoneE164          *string
		email              *string
		emailVerifiedAt    *time.Time
	)
	err := r.pool.QueryRow(ctx, `
		SELECT cp.account_id,
		       cp.first_name,
		       cp.last_name,
		       cp.default_address_id,
		       cp.marketing_consent_at,
		       cp.created_at,
		       a.phone_e164,
		       a.email::text,
		       a.email_verified_at
		FROM   customer_profile cp
		JOIN   account a ON a.id = cp.account_id
		WHERE  cp.account_id = $1
		  AND  cp.deleted_at IS NULL
		  AND  a.deleted_at  IS NULL
	`, callerID).Scan(
		&accountID,
		&firstName,
		&lastName,
		&defaultAddressID,
		&marketingConsentAt,
		&createdAt,
		&phoneE164,
		&email,
		&emailVerifiedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return customerProfileResponse{}, errNotFound
	}
	if err != nil {
		return customerProfileResponse{}, err
	}

	phone := ""
	if phoneE164 != nil {
		phone = *phoneE164
	}

	var consentAt *string
	if marketingConsentAt != nil {
		s := httpx.Timestamp(*marketingConsentAt)
		consentAt = &s
	}

	return customerProfileResponse{
		AccountID:          accountID,
		FirstName:          firstName,
		LastName:           lastName,
		Email:              email,
		EmailVerified:      emailVerifiedAt != nil,
		PhoneE164:          phone,
		AvatarURL:          nil, // presigned URL generation not wired yet
		DefaultAddressID:   defaultAddressID,
		MarketingConsentAt: consentAt,
		CreatedAt:          httpx.Timestamp(createdAt),
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

	// The revoke and the upsert must be one atomic unit. The token-uniqueness
	// index device_token_one_account (expo_push_token WHERE revoked_at IS NULL)
	// admits exactly one live row per token; doing the revoke and the insert in
	// separate autocommit statements leaves a window where a concurrent caller
	// can observe the pre-revoke state and collide. A transaction closes it.
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return deviceResponse{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after Commit is a no-op

	// Serialise all concurrent registrations of the SAME token. The partial
	// unique index device_token_one_account admits one live row per token, but
	// under READ COMMITTED two transactions registering the same token on
	// different device_ids can each pass the revoke without seeing the other's
	// uncommitted insert, and the loser then trips a 23505 on commit. A
	// transaction-scoped advisory lock keyed on the token makes those
	// registrations run one-at-a-time; the lock is released automatically at
	// commit/rollback. It is a cooperative lock only for this code path, so it
	// never blocks unrelated writers.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, in.ExpoPushToken); err != nil {
		return deviceResponse{}, err
	}

	// Step 1: revoke any live binding of this token that is NOT the exact row we
	// are about to upsert. This covers two cases the token-uniqueness index
	// would otherwise turn into a 500:
	//   - the token is live on a DIFFERENT account (I-25.1 / shared phone), and
	//   - the token is live on the SAME account under a DIFFERENT device_id
	//     (the ON CONFLICT below keys on (account_id, device_id) and would not
	//     touch that row, so inserting a second live row with the same token
	//     would violate the token-uniqueness index).
	// The row we keep (same account_id AND same device_id) is left alone so the
	// upsert can update it in place.
	if _, err = tx.Exec(ctx, `
		UPDATE device
		SET    revoked_at = now()
		WHERE  expo_push_token = $1
		  AND  revoked_at IS NULL
		  AND  NOT (account_id = $2 AND device_id = $3)
	`, in.ExpoPushToken, callerID, in.DeviceID); err != nil {
		return deviceResponse{}, err
	}

	// Step 2: upsert on (account_id, device_id). The unique index device_unique
	// covers (account_id, device_id) WHERE revoked_at IS NULL. RETURNING carries
	// last_seen_at back directly — no second round-trip.
	var resp deviceResponse
	var lastSeen time.Time
	if err = tx.QueryRow(ctx, `
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
		RETURNING device_id, platform, push_enabled, last_seen_at
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
		&resp.PushEnabled,
		&lastSeen,
	); err != nil {
		return deviceResponse{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return deviceResponse{}, err
	}

	// The DB role_context column collapses restaurant roles to 'RESTAURANT'
	// (its CHECK allows only CUSTOMER|RESTAURANT|RIDER|ADMIN). The contract's
	// Device.role_context is a Role enum with NO 'RESTAURANT' member, so we
	// echo back the caller's submitted, contract-valid Role rather than the
	// collapsed storage value — preventing enum drift on the wire.
	resp.RoleContext = in.RoleContext
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

	// channels_attempted is the DISTINCT set of channels recorded against the
	// notification in notification_delivery, aggregated as a text[]. It is always
	// an array (empty, never null) so the contract's required field is present.
	const channelsSubquery = `
		COALESCE(
		  (SELECT array_agg(DISTINCT nd.channel::text)
		   FROM notification_delivery nd
		   WHERE nd.notification_id = notification.id),
		  '{}'::text[]
		) AS channels_attempted`

	if cursor == "" && !unreadOnly {
		rows, err = r.pool.Query(ctx, `
			SELECT id, kind, title, body, priority, deep_link, read_at, created_at, order_id,`+channelsSubquery+`
			FROM   notification
			WHERE  account_id    = $1
			  AND  dismissed_at IS NULL
			ORDER  BY created_at DESC, id DESC
			LIMIT  $2
		`, callerID, limit+1)
	} else if cursor == "" && unreadOnly {
		rows, err = r.pool.Query(ctx, `
			SELECT id, kind, title, body, priority, deep_link, read_at, created_at, order_id,`+channelsSubquery+`
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
			SELECT id, kind, title, body, priority, deep_link, read_at, created_at, order_id,`+channelsSubquery+`
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
			SELECT id, kind, title, body, priority, deep_link, read_at, created_at, order_id,`+channelsSubquery+`
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
		var orderID *string
		var channels []string
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.Priority, &deepLink, &readAt, &createdAt, &orderID, &channels); err != nil {
			return nil, "", err
		}
		n.DeepLink = deepLink
		n.OrderID = orderID
		if channels == nil {
			channels = []string{}
		}
		n.ChannelsAttempted = channels
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
//
// The first read writes notification.read on the account's own channel, in
// the same transaction, so the caller's other devices clear the badge
// (contracts/websocket.md section 4.6). A repeat read writes nothing.
func (r *Repo) MarkNotificationRead(ctx context.Context, callerID, notificationID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	// An already-read notification still matches (idempotency). The only way
	// to get no row is an unknown id or a different account's id.
	var wasRead bool
	var readAt time.Time
	err = tx.QueryRow(ctx, `
		WITH prev AS (
		  SELECT id, read_at FROM notification WHERE id = $1 AND account_id = $2 FOR UPDATE
		)
		UPDATE notification n
		SET    read_at    = COALESCE(n.read_at, now()),
		       updated_at = now()
		FROM   prev
		WHERE  n.id = prev.id
		RETURNING prev.read_at IS NOT NULL, n.read_at
	`, notificationID, callerID).Scan(&wasRead, &readAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return err
	}
	if !wasRead {
		if err := realtime.EmitAccount(ctx, tx, callerID, realtime.NotificationRead{
			NotificationID: notificationID, ReadAt: realtime.At(readAt),
		}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
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
