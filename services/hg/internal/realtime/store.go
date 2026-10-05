package realtime

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ticketTTL is the 30-second single-use lifetime from P-20 / §1.1.
const ticketTTL = 30 * time.Second

// ErrTicketInvalid is returned when a ticket is unknown, already consumed, or
// expired. The upgrade answers HTTP 401 and — for a reuse — an audit event is
// written. It never distinguishes the three cases to the client.
var ErrTicketInvalid = errors.New("realtime: ticket invalid, consumed, or expired")

// Store is the realtime module's Postgres access. It owns the ticket table, the
// per-channel seq allocator, the immutable event log, the transactional outbox,
// and the SQL ownership predicates that gate every subscribe. Redis is never a
// source of identity or subscription rights (P-20).
type Store struct {
	pool *pgxpool.Pool
	// nodeID identifies this replica in realtime_connection.node_id.
	nodeID string
}

// NewStore builds a realtime Store over an existing pool.
func NewStore(pool *pgxpool.Pool, nodeID string) *Store {
	return &Store{pool: pool, nodeID: nodeID}
}

// TicketPrincipal is the identity a consumed ticket resolves to. It is the only
// way a socket learns who it is; the inbound frame schema cannot carry identity.
type TicketPrincipal struct {
	AccountID     string
	SessionID     string
	RolesSnapshot json.RawMessage
}

// hashTicket is the storage form of a ticket: SHA-256 of the raw base64url
// string. The plaintext is returned to the client once and never stored.
func hashTicket(raw string) []byte {
	h := sha256.Sum256([]byte(raw))
	return h[:]
}

// MintTicket creates a single-use ticket for a session and returns the raw
// base64url string (shown to the client once) and its expiry. The row records
// the account, session, role snapshot and client surface; Redis is not written
// here because nothing about identity is ever read from Redis (P-20).
func (s *Store) MintTicket(ctx context.Context, accountID, sessionID string, rolesSnapshot json.RawMessage, client string, issuedIP *string) (raw string, expiresAt time.Time, err error) {
	var buf [32]byte
	if _, err = rand.Read(buf[:]); err != nil {
		return "", time.Time{}, fmt.Errorf("ticket entropy: %w", err)
	}
	raw = base64.RawURLEncoding.EncodeToString(buf[:])
	expiresAt = time.Now().Add(ticketTTL).UTC()

	_, err = s.pool.Exec(ctx, `
		INSERT INTO realtime_ticket (ticket_hash, account_id, session_id, roles_snapshot, client, issued_ip, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		hashTicket(raw), accountID, sessionID, rolesSnapshot, client, issuedIP, expiresAt)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("insert ticket: %w", err)
	}
	return raw, expiresAt, nil
}

// ConsumeTicket atomically consumes a ticket on upgrade. It is the conditional
// UPDATE from §1.1: zero rows means the upgrade is refused (ErrTicketInvalid)
// and — because a plausible cause is reuse — the caller writes a
// realtime.ticket_reuse audit event. There is no path that consumes a ticket
// twice.
func (s *Store) ConsumeTicket(ctx context.Context, raw string) (TicketPrincipal, error) {
	var p TicketPrincipal
	err := s.pool.QueryRow(ctx, `
		UPDATE realtime_ticket
		   SET consumed_at = now()
		 WHERE ticket_hash = $1 AND consumed_at IS NULL AND expires_at > now()
		RETURNING account_id, session_id, roles_snapshot`,
		hashTicket(raw)).Scan(&p.AccountID, &p.SessionID, &p.RolesSnapshot)
	if errors.Is(err, pgx.ErrNoRows) {
		return TicketPrincipal{}, ErrTicketInvalid
	}
	if err != nil {
		return TicketPrincipal{}, fmt.Errorf("consume ticket: %w", err)
	}
	return p, nil
}

// AuditTicketReuse writes the realtime.ticket_reuse audit event. The audit
// table's BEFORE INSERT trigger allocates day/seq and the hash chain; the
// handler supplies only the business columns.
func (s *Store) AuditTicketReuse(ctx context.Context, requestID, ip string) error {
	var ipArg any
	if ip != "" {
		ipArg = ip
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO audit_event (actor_kind, action, subject_type, outcome, reason_code, request_id, ip, prev_hash, hash)
		VALUES ('SYSTEM', 'realtime.ticket_reuse', 'realtime_ticket', 'DENIED', 'ticket_invalid', $1, $2, ''::bytea, ''::bytea)`,
		requestID, ipArg)
	if err != nil {
		return fmt.Errorf("audit ticket_reuse: %w", err)
	}
	return nil
}

// RegisterConnection records a live socket in realtime_connection and returns
// its id. disconnected_at is set on close so the live-connection indexes stay
// accurate.
func (s *Store) RegisterConnection(ctx context.Context, accountID, sessionID, client string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO realtime_connection (account_id, session_id, node_id, client)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text`,
		accountID, sessionID, s.nodeID, client).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("register connection: %w", err)
	}
	return id, nil
}

// CloseConnection marks a connection disconnected with its close code.
func (s *Store) CloseConnection(ctx context.Context, connID string, code int, reason string) {
	if connID == "" {
		return
	}
	_, _ = s.pool.Exec(ctx, `
		UPDATE realtime_connection
		   SET disconnected_at = now(), close_code = $2, close_reason = $3
		 WHERE id = $1 AND disconnected_at IS NULL`,
		connID, code, reason)
}

// TouchReauth records that a connection re-authenticated, resetting the 15-minute
// window (§1.3).
func (s *Store) TouchReauth(ctx context.Context, connID string) {
	if connID == "" {
		return
	}
	_, _ = s.pool.Exec(ctx, `UPDATE realtime_connection SET reauthed_at = now(), last_seen_at = now() WHERE id = $1`, connID)
}

// SessionRevoked reports whether a session has been revoked. The socket refreshes
// this from Postgres and closes 4401 within 10 s; Postgres is the correct
// source, Redis only makes it instant (§1.3).
func (s *Store) SessionRevoked(ctx context.Context, sessionID string) (bool, error) {
	var revoked bool
	err := s.pool.QueryRow(ctx,
		`SELECT revoked_at IS NOT NULL FROM session WHERE id = $1`, sessionID).Scan(&revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		// A session that no longer exists is, for the socket's purposes, revoked.
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("session revoked check: %w", err)
	}
	return revoked, nil
}

// SubResult is the outcome of an ownership check, mirroring the subscribe_error
// closed set plus an "allowed" success.
type SubResult int

const (
	SubAllowed SubResult = iota
	SubNotFound
	SubForbidden
)

// Grant is the outcome of an ownership check: whether the principal may
// subscribe and, when it may, the ONE role that authorised it. The gateway
// projects every event on the subscription for that role (projection.go), so
// the ownership decision and the projection are made from the same facts, in
// the same read.
//
// Viewer is ViewNone whenever Result is not SubAllowed, so a denied or failed
// check can never be mistaken for a role.
type Grant struct {
	Result SubResult
	Viewer Viewer
}

func allowed(v Viewer) Grant { return Grant{Result: SubAllowed, Viewer: v} }

var (
	notFound  = Grant{Result: SubNotFound}
	forbidden = Grant{Result: SubForbidden}
)

// privilegedRoles are the roles that may read any order, restaurant or rider
// channel (contracts/websocket.md section 3.1).
var privilegedRoles = []string{"SUPPORT_AGENT", "ADMIN", "SUPER_ADMIN"}

// AuthorizeSubscribe runs the fresh Postgres ownership check for a subscribe —
// the socket is not a second, weaker authorization surface
// (contracts/websocket.md, "The three rules this document exists to enforce",
// rule 2; section 3.1, "Channels") — and names the role that authorised it. It
// obeys the 404-vs-403 rule: an unrelated principal that asks for an order it
// has no relationship to gets not_found, never forbidden, so it cannot learn
// the order exists.
//
// The predicates mirror the HTTP surface's ownership rules:
//   - order:{id}       the customer (order.account_id), the assigned rider
//     (dispatch.rider_account_id), staff of the order's restaurant (a live
//     account_role scoped to order.restaurant_id), or support/admin.
//   - restaurant:{id}  live scoped staff grant, or support/admin.
//   - rider:{id}       the rider themselves (holding RIDER), or support/admin.
//   - account:{id}     that account only.
//   - admin:ops        ADMIN, SUPER_ADMIN, SUPPORT_AGENT.
//
// When more than one relationship holds, the role is the first in this order:
// customer, rider, restaurant staff, support. A participant is projected as
// that participant, and support's view is only for a principal with no other
// relationship to the channel. Nothing is ever projected for two roles at once
// (https://github.com/shaiknoorullah/hg-mono/issues/247).
//
// Any error is a denial: the Grant then carries no role.
func (s *Store) AuthorizeSubscribe(ctx context.Context, accountID string, roles []string, ch Channel) (Grant, error) {
	priv := hasAny(roles, privilegedRoles...)

	switch ch.Kind {
	case KindAccount:
		if ch.Subject == accountID {
			return allowed(ViewAccountOwner), nil
		}
		// Another account's personal channel simply does not exist for you.
		return notFound, nil

	case KindAdminOps:
		if priv {
			return allowed(ViewSupport), nil
		}
		return forbidden, nil

	case KindRider:
		switch {
		case ch.Subject == accountID && hasAny(roles, "RIDER"):
			return allowed(ViewRiderSelf), nil
		case priv:
			return allowed(ViewSupport), nil
		}
		return notFound, nil

	case KindRestaurant:
		ok, err := s.hasLiveRestaurantGrant(ctx, accountID, ch.Subject)
		if err != nil {
			return forbidden, err
		}
		switch {
		case ok:
			return allowed(ViewRestaurant), nil
		case priv:
			return allowed(ViewSupport), nil
		}
		return notFound, nil

	case KindOrder:
		rel, err := s.orderRelationship(ctx, accountID, ch.Subject)
		if err != nil {
			return forbidden, err
		}
		switch {
		case !rel.exists:
			return notFound, nil
		case rel.customer:
			return allowed(ViewCustomer), nil
		case rel.rider:
			return allowed(ViewRider), nil
		case rel.staff:
			return allowed(ViewRestaurant), nil
		case priv:
			return allowed(ViewSupport), nil
		}
		// The order exists but you are not a participant. The 404-vs-403 rule
		// (contracts/websocket.md section 4.1, the note under the control
		// frames) says an unrelated principal must not learn it exists, so this
		// is not_found, not forbidden.
		return notFound, nil
	}
	return forbidden, nil
}

// hasLiveRestaurantGrant reports whether an account holds a live (non-revoked)
// role scoped to a restaurant.
func (s *Store) hasLiveRestaurantGrant(ctx context.Context, accountID, restaurantID string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM account_role
			 WHERE account_id = $1
			   AND scope_type = 'RESTAURANT'
			   AND scope_id = $2
			   AND revoked_at IS NULL)`,
		accountID, restaurantID).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("restaurant grant check: %w", err)
	}
	return ok, nil
}

// orderRelation is every way an account is related to one order.
type orderRelation struct {
	exists, customer, rider, staff bool
}

// orderRelationship answers, in one round trip, whether the order exists and
// each way this account takes part in it.
func (s *Store) orderRelationship(ctx context.Context, accountID, orderID string) (orderRelation, error) {
	var r orderRelation
	err := s.pool.QueryRow(ctx, `
		SELECT
			TRUE,
			o.account_id = $2,
			EXISTS (
				SELECT 1 FROM dispatch d
				 WHERE d.order_id = o.id
				   AND d.rider_account_id = $2),
			EXISTS (
				SELECT 1 FROM account_role ar
				 WHERE ar.account_id = $2
				   AND ar.scope_type = 'RESTAURANT'
				   AND ar.scope_id = o.restaurant_id
				   AND ar.revoked_at IS NULL)
		FROM "order" o
		WHERE o.id = $1`,
		orderID, accountID).Scan(&r.exists, &r.customer, &r.rider, &r.staff)
	if errors.Is(err, pgx.ErrNoRows) {
		return orderRelation{}, nil
	}
	if err != nil {
		return orderRelation{}, fmt.Errorf("order relationship: %w", err)
	}
	return r, nil
}

// ChannelHead returns the current head seq for a channel — what subscribed's
// cursor_seq reports. Zero means the channel has never emitted.
func (s *Store) ChannelHead(ctx context.Context, channel string) (int64, error) {
	var head int64
	err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(last_seq, 0) FROM channel_cursor WHERE channel = $1`, channel).Scan(&head)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("channel head: %w", err)
	}
	return head, nil
}

// replayLimit is the §6.3 cap: at most 1000 events per resume.
const replayLimit = 1000

// StoredEvent is one row of the immutable realtime_event log, in envelope form.
type StoredEvent struct {
	ULID     string
	Channel  string
	Seq      int64
	Type     string
	V        int
	TS       time.Time
	Audience []string
	Payload  json.RawMessage
}

// Replay reads events for a channel with seq > afterSeq in order, up to
// replayLimit. It is a non-destructive read of an immutable table (§6.3): any
// number of clients may replay the same range with identical results, and
// reading a queued notification never consumes it. truncated is true when the
// gap is wider than the cap or older than retention.
func (s *Store) Replay(ctx context.Context, channel string, afterSeq int64) (events []StoredEvent, truncated bool, err error) {
	head, err := s.ChannelHead(ctx, channel)
	if err != nil {
		return nil, false, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT ulid, channel, seq, type, v, created_at, audience, payload
		  FROM realtime_event
		 WHERE channel = $1 AND seq > $2
		 ORDER BY seq ASC
		 LIMIT $3`,
		channel, afterSeq, replayLimit+1)
	if err != nil {
		return nil, false, fmt.Errorf("replay query: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var e StoredEvent
		if err := rows.Scan(&e.ULID, &e.Channel, &e.Seq, &e.Type, &e.V, &e.TS, &e.Audience, &e.Payload); err != nil {
			return nil, false, fmt.Errorf("replay scan: %w", err)
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("replay rows: %w", err)
	}

	if len(events) > replayLimit {
		events = events[:replayLimit]
		truncated = true
	}
	// The gap is also truncated when the oldest event we could return is newer
	// than afterSeq+1: retention dropped rows the client still needs.
	if !truncated && len(events) > 0 && afterSeq > 0 && events[0].Seq > afterSeq+1 {
		truncated = true
	}
	// A caller resuming from a seq that is impossibly far behind the head, with
	// no rows to show for it, has fallen off the 7-day window.
	if !truncated && len(events) == 0 && afterSeq < head-int64(replayLimit) {
		truncated = true
	}
	return events, truncated, nil
}

// EmitInTx allocates a gapless per-channel seq and writes the realtime_event and
// its outbox_message in the SAME transaction as the caller's state change
// (§6.1). It is the transactional outbox: an event exists if and only if the
// state change that produced it committed. The relay publishes to Redis
// afterwards; this function never touches Redis.
//
// The caller passes a pgx.Tx that already contains the state mutation; on commit
// both the state and the event become visible together.
//
// It is the low-level writer under Emit (emit.go), which producers use. It
// refuses an event type that is not in the catalogue, or one written to a
// channel family that does not carry it: such an event could never be
// delivered (Project drops it), so writing it would only burn a seq and leave
// every subscriber a gap.
func EmitInTx(ctx context.Context, tx pgx.Tx, channel, eventType string, version int, audience []string, payload json.RawMessage, orderID, accountID *string) (seq int64, ulid string, err error) {
	s, ok := byType[eventType]
	if !ok {
		return 0, "", fmt.Errorf("event type %q is not in the realtime catalogue", eventType)
	}
	ch, ok := ParseChannel(channel)
	if !ok || ch.Kind != s.kind {
		return 0, "", fmt.Errorf("event type %q does not travel on channel %q", eventType, channel)
	}
	if err = tx.QueryRow(ctx, `SELECT next_channel_seq($1)`, channel).Scan(&seq); err != nil {
		return 0, "", fmt.Errorf("allocate seq: %w", err)
	}
	ulid = newEventULID()

	// realtime_event.audience is text[] NOT NULL: an empty array is the wire
	// form of "all participants" (§4.2). A nil slice would be sent as SQL NULL
	// and violate the constraint, so normalise it to an empty array — which is
	// exactly the all-participants audience the projection gate expects.
	if audience == nil {
		audience = []string{}
	}

	var eventID string
	err = tx.QueryRow(ctx, `
		INSERT INTO realtime_event (ulid, channel, seq, type, v, audience, payload, order_id, account_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id::text`,
		ulid, channel, seq, eventType, version, audience, payload, orderID, accountID).Scan(&eventID)
	if err != nil {
		return 0, "", fmt.Errorf("insert realtime_event: %w", err)
	}

	// The outbox row carries what the relay publishes to Redis: the client
	// envelope plus the event's audience out-of-band. Redis is internal fan-out,
	// so the RelayMessage wrapper is safe here — the audience never reaches the
	// client wire, but it lets each replica apply the §5 audience gate at send
	// time without a second Postgres read.
	env := Envelope{
		ID:      ulid,
		Seq:     seq,
		Channel: channel,
		Type:    eventType,
		V:       version,
		TS:      time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		Data:    payload,
	}
	envBytes, err := json.Marshal(RelayMessage{Audience: audience, Envelope: env})
	if err != nil {
		return 0, "", fmt.Errorf("marshal relay message: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO outbox_message (kind, channel, realtime_event_id, seq, payload)
		VALUES ('REALTIME', $1, $2, $3, $4)`,
		channel, eventID, seq, envBytes)
	if err != nil {
		return 0, "", fmt.Errorf("insert outbox_message: %w", err)
	}
	return seq, ulid, nil
}

// AllowedChannels derives the channels a principal may subscribe to, from the
// same ownership predicates as the HTTP surface (§1.1, §3.1). hello lists these,
// and a subscribe naming anything else is refused. The set always includes the
// principal's own account channel (auto-subscribed) and, for a rider, their
// rider channel; admin roles get admin:ops. Live order channels are enumerated
// from the principal's active orders so the ticket carries a usable starting set
// — but the authoritative gate is always the per-subscribe AuthorizeSubscribe
// check, not this list.
func (s *Store) AllowedChannels(ctx context.Context, accountID string, roles []string) ([]string, error) {
	set := map[string]struct{}{}
	add := func(c string) { set[c] = struct{}{} }

	add(AccountChannel(accountID))
	if hasAny(roles, "RIDER") {
		add(RiderChannel(accountID))
	}
	if hasAny(roles, privilegedRoles...) {
		add(AdminOpsChannel)
	}

	// Restaurant channels for every live scoped grant this account holds.
	rrows, err := s.pool.Query(ctx, `
		SELECT DISTINCT scope_id::text
		  FROM account_role
		 WHERE account_id = $1 AND scope_type = 'RESTAURANT' AND revoked_at IS NULL`,
		accountID)
	if err != nil {
		return nil, fmt.Errorf("allowed restaurants: %w", err)
	}
	for rrows.Next() {
		var rid string
		if err := rrows.Scan(&rid); err != nil {
			rrows.Close()
			return nil, fmt.Errorf("scan restaurant scope: %w", err)
		}
		add(RestaurantChannel(rid))
	}
	rrows.Close()
	if err := rrows.Err(); err != nil {
		return nil, fmt.Errorf("allowed restaurants rows: %w", err)
	}

	// Active order channels: orders this account placed, or is the assigned
	// rider for. A privileged principal is not enumerated here — their access is
	// per-subscribe and unbounded.
	orows, err := s.pool.Query(ctx, `
		SELECT DISTINCT o.id::text
		  FROM "order" o
		  LEFT JOIN dispatch d ON d.order_id = o.id
		 WHERE o.account_id = $1 OR d.rider_account_id = $1`,
		accountID)
	if err != nil {
		return nil, fmt.Errorf("allowed orders: %w", err)
	}
	for orows.Next() {
		var oid string
		if err := orows.Scan(&oid); err != nil {
			orows.Close()
			return nil, fmt.Errorf("scan order id: %w", err)
		}
		add(OrderChannel(oid))
	}
	orows.Close()
	if err := orows.Err(); err != nil {
		return nil, fmt.Errorf("allowed orders rows: %w", err)
	}

	out := make([]string, 0, len(set))
	for c := range set {
		out = append(out, c)
	}
	return out, nil
}

// hasAny reports whether roles contains any of want.
func hasAny(roles []string, want ...string) bool {
	for _, r := range roles {
		for _, w := range want {
			if r == w {
				return true
			}
		}
	}
	return false
}
