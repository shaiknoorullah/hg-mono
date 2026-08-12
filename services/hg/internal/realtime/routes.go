package realtime

import (
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Routes registers the realtime module's HTTP surface on the shared router. Each
// route carries an explicit Policy and the contract's operationId, and nothing
// here is public: the ticket and schema endpoints both require authentication,
// and the WebSocket upgrade resolves identity from the ticket it consumes rather
// than from the request principal — so it is registered with a real Action too,
// denied by default until a token authenticator exists.
//
// This is the single point where realtime attaches to the router; it is called
// from cmd/hg/main.go at the designated registration site.
func Routes(r *httpx.Router, h *Handler) {
	r.Post("/v1/realtime/ticket", httpx.Policy{
		Action:      ActionTicketCreate,
		Class:       httpx.ClassRealtime,
		OperationID: "createRealtimeTicket",
	}, h.CreateTicket)

	r.Get("/v1/realtime/schema", httpx.Policy{
		Action:      ActionSchemaRead,
		Class:       httpx.ClassRead,
		OperationID: "getRealtimeSchema",
	}, h.Schema)

	// The WebSocket upgrade. A browser cannot set Authorization on an upgrade —
	// that is the entire reason the single-use ticket exists (§1.1). So the HTTP
	// guard cannot authenticate this route from the request the way it does the
	// REST surface: identity is resolved inside the handler by consuming the
	// ticket (or, once auth lands, validating the native bearer sub-protocol).
	//
	// The route is therefore registered Public at the middleware layer, and the
	// handler enforces authentication itself: no ticket, an invalid/reused/expired
	// ticket, or a disallowed Origin is refused with an HTTP status before any
	// frame is exchanged. "Public" here means "the chain does not gate it", not
	// "unauthenticated" — every socket still ends up bound to a server-derived
	// principal, and a connection that cannot be is closed, never opened.
	r.Get("/v1/ws", httpx.Policy{
		Public:      true,
		Class:       httpx.ClassRealtime,
		OperationID: "connectWebSocket",
	}, h.Upgrade)
}

// PublicRouteAllowlist is the realtime module's contribution to the I-06.2
// checked-in public set. Only the WebSocket upgrade is public, and it is public
// because the browser upgrade cannot carry Authorization — identity is resolved
// from the single-use ticket the handler consumes, never asserted by the client.
func PublicRouteAllowlist() []string {
	return []string{"GET /v1/ws"}
}
