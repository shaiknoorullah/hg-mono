package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Actions guarding the realtime HTTP surface (P-05). The role→action mapping is
// the auth sibling's matrix; these constants name the permission a route
// requires, and Verify refuses to boot a route without one.
const (
	// ActionTicketCreate guards createRealtimeTicket. Every signed-in role may
	// mint a ticket for its own session (contract x-roles lists all of them).
	ActionTicketCreate httpx.Action = "realtime_ticket.create"
	// ActionSchemaRead guards getRealtimeSchema.
	ActionSchemaRead httpx.Action = "realtime_schema.read"
)

// RateLimiter counts requests against a key in fixed windows. auth.RateLimiter
// implements it over Redis: Allow returns nil within the limit,
// auth.ErrRateLimited over it, and any other error when Redis cannot answer.
type RateLimiter interface {
	Allow(ctx context.Context, key string, limit int64, window time.Duration) error
}

// rateWindow is the window every realtime request limit is counted over.
const rateWindow = time.Minute

// upgradeStore is the part of Store the upgrade uses before the socket is
// served: resolving the ticket and registering the connection. *Store
// implements it; the capacity tests substitute one that needs no Postgres.
type upgradeStore interface {
	ConsumeTicket(ctx context.Context, raw string) (TicketPrincipal, error)
	AuditTicketReuse(ctx context.Context, requestID, ip string) error
	RegisterConnection(ctx context.Context, accountID, sessionID, client string) (string, error)
}

// Handler serves the realtime HTTP operations and the WebSocket upgrade.
type Handler struct {
	store       *Store
	upgrades    upgradeStore
	gw          *Gateway
	log         *slog.Logger
	corsOrigins map[string]struct{}
	limiter     RateLimiter
}

// NewHandler builds the realtime HTTP handler. limiter counts upgrade attempts
// per client address and ticket mints per session against the gateway's
// Limits; a nil limiter counts nothing (tests and local runs without Redis).
func NewHandler(store *Store, gw *Gateway, log *slog.Logger, corsOrigins []string, limiter RateLimiter) *Handler {
	set := make(map[string]struct{}, len(corsOrigins))
	for _, o := range corsOrigins {
		set[strings.ToLower(strings.TrimSuffix(o, "/"))] = struct{}{}
	}
	return &Handler{store: store, upgrades: store, gw: gw, log: log, corsOrigins: set, limiter: limiter}
}

// allow counts one request against key and reports whether it is within limit
// for the current rateWindow.
//
// A limiter that cannot answer (Redis is down) lets the request through, as
// the rate-limiting spec requires for every class except sign-in
// (docs/spec/01-platform.md, "P-38 — Rate limiting", Redis-down policy:
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/01-platform.md#p-38--rate-limiting).
// The socket caps are counted in memory and still hold without Redis.
func (h *Handler) allow(r *http.Request, key string, limit int) bool {
	if h.limiter == nil {
		return true
	}
	err := h.limiter.Allow(r.Context(), key, int64(limit), rateWindow)
	switch {
	case err == nil:
		return true
	case errors.Is(err, auth.ErrRateLimited):
		return false
	default:
		h.log.Warn("realtime rate limiter unavailable; allowing the request",
			slog.String("key", key), slog.String("error", err.Error()))
		return true
	}
}

// refuseRateLimited answers a request over one of the realtime request limits
// with 429 RATE_LIMITED and a Retry-After of one window. Nothing was executed.
func refuseRateLimited(w http.ResponseWriter, r *http.Request, message string) {
	w.Header().Set("Retry-After", strconv.Itoa(int(rateWindow/time.Second)))
	httpx.Fail(w, r, http.StatusTooManyRequests, httpx.CodeRateLimited, message, nil)
}

// ticketMintKey is the Redis counter for ticket mints by one session. Rebuild
// source: none needed. A flush grants each session one fresh window, never a
// socket past the per-session cap, which is counted in memory.
func ticketMintKey(sessionID string) string {
	return "rl:rt_ticket:session:" + sessionID
}

// upgradeAttemptKey is the Redis counter for upgrade attempts from one client
// address. httpx.RateLimitKey buckets it: an IPv6 caller is counted per /64,
// and an address that could not be resolved shares one "unknown" budget.
// Rebuild source: none needed; a flush grants one fresh window.
func upgradeAttemptKey(r *http.Request) string {
	return "rl:rt_upgrade:addr:" + httpx.RateLimitKey(httpx.ClientIP(r))
}

// realtimeTicketResponse is the RealtimeTicket contract schema (§1.1).
type realtimeTicketResponse struct {
	Ticket          string   `json:"ticket"`
	ExpiresAt       string   `json:"expires_at"`
	WebsocketURL    string   `json:"websocket_url"`
	AllowedChannels []string `json:"allowed_channels"`
}

// CreateTicket implements createRealtimeTicket (POST /v1/realtime/ticket). It is
// a normal authenticated REST call: the principal comes from the middleware
// chain, never from the body, and the ticket it mints is bound to that
// principal's session. The response carries the allowed channel set derived from
// the same ownership predicates as the socket's per-subscribe check.
func (h *Handler) CreateTicket(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous || p.AccountID == "" || p.SessionID == "" {
		// Defence in depth: the guard already denies anonymous callers on this
		// non-public route, but a ticket without a session is meaningless.
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required to mint a realtime ticket.", nil)
		return
	}

	// Each ticket is a Postgres write and opens one socket, so one session may
	// mint only so many a minute (issue #288,
	// https://github.com/shaiknoorullah/hg-mono/issues/288).
	if !h.allow(r, ticketMintKey(p.SessionID), h.gw.limits.TicketsPerSession) {
		refuseRateLimited(w, r, "Too many realtime tickets for this session. Please wait before trying again.")
		return
	}

	client := strings.TrimSpace(r.Header.Get("X-HG-Client"))
	if !validClientSurface(client) {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed,
			"A valid X-HG-Client header is required.",
			[]httpx.FieldError{{Field: "X-HG-Client", Code: "required", Message: "must be a registered client surface"}})
		return
	}

	roles := make([]string, 0, len(p.Roles))
	for _, role := range p.Roles {
		roles = append(roles, string(role))
	}
	rolesSnapshot, err := json.Marshal(roles)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Could not encode roles.", nil)
		return
	}

	var ip *string
	if host := httpx.ClientIP(r); host != "" {
		ip = &host
	}

	ticket, expiresAt, err := h.store.MintTicket(r.Context(), p.AccountID, p.SessionID, rolesSnapshot, client, ip)
	if err != nil {
		h.log.Error("mint ticket failed", slog.String("error", err.Error()))
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Could not mint a ticket.", nil)
		return
	}

	allowed, err := h.store.AllowedChannels(r.Context(), p.AccountID, roles)
	if err != nil {
		h.log.Error("allowed channels failed", slog.String("error", err.Error()))
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Could not resolve channels.", nil)
		return
	}

	httpx.Respond(w, r, http.StatusOK, realtimeTicketResponse{
		Ticket:          ticket,
		ExpiresAt:       httpx.Timestamp(expiresAt),
		WebsocketURL:    websocketURL(r),
		AllowedChannels: allowed,
	})
}

// Schema implements getRealtimeSchema (GET /v1/realtime/schema). It returns the
// RealtimeSchemaBundle: the protocol version and a map keyed {type}@v{version}
// to the JSON Schema of each payload.
func (h *Handler) Schema(w http.ResponseWriter, r *http.Request) {
	httpx.Respond(w, r, http.StatusOK, schemaBundle())
}

// Upgrade implements the WebSocket upgrade at GET /v1/ws. Identity is resolved
// server-side from the single-use ticket (or the native bearer sub-protocol);
// the inbound frame schema has no identity field. The origin is checked against
// the CORS allowlist (§1.1). A ticket that is unknown, consumed or expired is
// refused with HTTP 401 before any frame is exchanged, and writes a
// realtime.ticket_reuse audit event.
//
// Three caps keep one caller from filling the replica (issue #288,
// https://github.com/shaiknoorullah/hg-mono/issues/288; contracts/websocket.md
// "Limits"): upgrade attempts per client address, then live sockets per
// account and per session once the ticket says who is connecting, under the
// replica-wide cap.
func (h *Handler) Upgrade(w http.ResponseWriter, r *http.Request) {
	// Count every attempt from this address first, ticket or not, so a flood of
	// upgrades cannot keep ticket lookups, audit writes and handshakes busy.
	if !h.allow(r, upgradeAttemptKey(r), h.gw.limits.UpgradesPerAddress) {
		refuseRateLimited(w, r, "Too many realtime connection attempts from this address. Please wait before trying again.")
		return
	}

	// Origin check on upgrade (§1.1). An empty Origin is a non-browser client and
	// is allowed through to the ticket/bearer check; a present Origin must be on
	// the allowlist.
	if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" {
		if _, ok := h.corsOrigins[strings.ToLower(strings.TrimSuffix(origin, "/"))]; !ok {
			httpx.Fail(w, r, http.StatusForbidden, httpx.CodeOriginNotAllowed,
				"This origin is not allowed to open a realtime connection.", nil)
			return
		}
	}

	// Take a replica slot before any Postgres work, so a full replica sheds load
	// cheaply. This defer is the only release of every slot the upgrade takes:
	// a refused ticket, a refused account or session, a failed handshake, a
	// failed registration and a closed socket all leave through it, and a lease
	// gives its slots back once however often it is released (slots.go).
	lease, ok := h.gw.admit()
	if !ok {
		h.refuseAtCapacity(w, r)
		return
	}
	defer lease.release()

	principal, roles, err := h.resolveUpgradeIdentity(w, r)
	if err != nil {
		// resolveUpgradeIdentity already wrote the 401 and any audit event.
		return
	}

	// Now that the ticket says who is connecting, take the account's and the
	// session's slots. The ticket is spent either way: a refused client mints a
	// new one when it retries.
	if err := lease.bind(principal.AccountID, principal.SessionID); err != nil {
		h.refuseConnectionLimit(w, r, principal, err)
		return
	}

	client := r.URL.Query().Get("client")
	if !validClientSurface(client) {
		client = "web"
	}

	ws, err := upgrade(w, r)
	if err != nil {
		// The handshake failed after we consumed the ticket. Nothing was sent to
		// the client as a frame; a plain error is the right answer.
		h.log.Warn("websocket handshake failed", slog.String("error", err.Error()))
		return
	}

	connID, err := h.upgrades.RegisterConnection(r.Context(), principal.AccountID, principal.SessionID, client)
	if err != nil {
		h.log.Warn("register connection failed", slog.String("error", err.Error()))
		_ = ws.writeClose(CloseNormal, "registration failed")
		return
	}

	// The socket outlives the HTTP request context, so it runs under a fresh
	// context tied to the process, cancelled when the gateway shuts down.
	conn := newConnection(h.gw, ws, h.log.With(slog.String("account_id", principal.AccountID)),
		connID, principal.AccountID, principal.SessionID, roles)
	conn.serve()
}

// refuseAtCapacity answers an upgrade this replica has no room for. It completes
// the handshake and closes with 1013 (try again later), because a browser
// cannot read the HTTP status of a refused upgrade but can read a close code.
// The ticket is left unconsumed and nothing else is sent. The client reconnects
// with backoff, and the load balancer may route it to the other replica.
func (h *Handler) refuseAtCapacity(w http.ResponseWriter, r *http.Request) {
	h.log.Warn("realtime replica at capacity; refusing socket", slog.Int("max_sockets", h.gw.limits.MaxSockets))
	closeAfterHandshake(w, r, h.log, reasonAtCapacity)
}

// refuseConnectionLimit answers an upgrade whose account or session already
// holds its maximum sockets on this replica. Like refuseAtCapacity it completes
// the handshake and closes with 1013, reason connection_limit, so a browser can
// read why. The client backs off; a slot frees when one of its sockets closes.
func (h *Handler) refuseConnectionLimit(w http.ResponseWriter, r *http.Request, p TicketPrincipal, cause error) {
	h.log.Warn("realtime connection limit reached; refusing socket",
		slog.String("account_id", p.AccountID), slog.String("cause", cause.Error()))
	closeAfterHandshake(w, r, h.log, reasonConnectionLimit)
}

// closeAfterHandshake completes the handshake and sends only a 1013 close with
// reason.
func closeAfterHandshake(w http.ResponseWriter, r *http.Request, log *slog.Logger, reason string) {
	ws, err := upgrade(w, r)
	if err != nil {
		log.Warn("websocket handshake failed", slog.String("error", err.Error()))
		return
	}
	_ = ws.writeClose(CloseTryAgainLater, reason)
}

// resolveUpgradeIdentity consumes the ticket, or falls back to the native bearer
// sub-protocol, and returns the resolved principal. On failure it writes the 401
// and (for a ticket) the audit event, then returns an error.
func (h *Handler) resolveUpgradeIdentity(w http.ResponseWriter, r *http.Request) (TicketPrincipal, []string, error) {
	ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
	if ticket != "" {
		p, err := h.upgrades.ConsumeTicket(r.Context(), ticket)
		if err != nil {
			// A failed consume is refused before any frame. A plausible cause is
			// reuse, so an audit event is written (§1.1).
			_ = h.upgrades.AuditTicketReuse(r.Context(), httpx.RequestIDFrom(r.Context()), httpx.ClientIP(r))
			httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
				"The realtime ticket is invalid, already used, or expired.", nil)
			return TicketPrincipal{}, nil, err
		}
		return p, rolesFromSnapshot(p.RolesSnapshot), nil
	}

	// Native alternative: bearer token in Sec-WebSocket-Protocol (§1.2). The auth
	// sibling owns token validation; until it lands there is no way to safely
	// resolve a bearer here, so this path is refused rather than trusting it.
	if bearer := bearerFromProtocols(r.Header.Get("Sec-WebSocket-Protocol")); bearer != "" {
		// TODO(auth sibling): validate the EdDSA access token exactly as the HTTP
		// path does and converge on the same Principal (§1.2). Refusing here is
		// the safe stub: a socket that cannot verify a token must not open.
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Bearer sub-protocol upgrade is not yet supported; mint a ticket over REST.", nil)
		return TicketPrincipal{}, nil, errors.New("bearer path not implemented")
	}

	httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
		"A realtime ticket is required to open this connection.", nil)
	return TicketPrincipal{}, nil, errors.New("no ticket")
}

// rolesFromSnapshot decodes the roles_snapshot jsonb into a role token slice. The
// snapshot may be a plain array of strings or an array of {r,s} objects; both are
// accepted so the ticket and session snapshots interoperate.
func rolesFromSnapshot(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var plain []string
	if err := json.Unmarshal(raw, &plain); err == nil {
		return plain
	}
	var scoped []struct {
		R string `json:"r"`
	}
	if err := json.Unmarshal(raw, &scoped); err == nil {
		out := make([]string, 0, len(scoped))
		for _, s := range scoped {
			out = append(out, s.R)
		}
		return out
	}
	return nil
}

// bearerFromProtocols extracts the access token from a
// "hg.v1, bearer.<jwt>" Sec-WebSocket-Protocol header (§1.2).
func bearerFromProtocols(header string) string {
	for _, p := range strings.Split(header, ",") {
		p = strings.TrimSpace(p)
		if after, ok := strings.CutPrefix(p, "bearer."); ok {
			return after
		}
	}
	return ""
}

// validClientSurface reports whether s is a member of the ClientSurface enum
// (client_surface in the schema).
func validClientSurface(s string) bool {
	switch s {
	case "customer-app", "rider-app", "restaurant-web", "admin-web", "web":
		return true
	}
	return false
}

// websocketURL builds the wss:// upgrade URL from the request host, defaulting to
// the contract's canonical host when the request carries none.
func websocketURL(r *http.Request) string {
	host := r.Host
	if host == "" {
		return "wss://api.halalgoes.com/v1/ws"
	}
	scheme := "wss"
	if r.TLS == nil && (strings.HasPrefix(host, "localhost") || strings.HasPrefix(host, "127.0.0.1")) {
		scheme = "ws"
	}
	return scheme + "://" + host + "/v1/ws"
}
