package dispatch

import (
	"regexp"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// uuidRE matches a canonical UUID (any version). Path ids are UUIDs (§0.1); a
// non-UUID id is a 404 rather than a database round-trip.
var uuidRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func validUUID(s string) bool { return uuidRE.MatchString(s) }

// Routes registers this module's routes on the shared router. Every route
// carries an explicit Policy and the contract's operationId; none is public
// (deny-by-default). All operate on the caller's own rider (`/riders/me/...`),
// so ownership is the principal's own account_id and needs no extra path check.
func Routes(r *httpx.Router, h *Handler) {
	r.Put("/v1/riders/me/availability", httpx.Policy{
		Action:      ActionRiderAvailabilityWrite,
		Class:       httpx.ClassWrite,
		OperationID: "setRiderAvailability",
	}, h.SetAvailability)

	r.Post("/v1/riders/me/positions", httpx.Policy{
		Action:      ActionRiderPositionWrite,
		Class:       httpx.ClassWrite,
		OperationID: "reportRiderPositions",
	}, h.ReportPositions)

	r.Get("/v1/riders/me/offers/current", httpx.Policy{
		Action:      ActionOfferRead,
		Class:       httpx.ClassRead,
		OperationID: "getCurrentOffer",
	}, h.GetCurrentOffer)

	r.Post("/v1/riders/me/offers/{offerId}/accept", httpx.Policy{
		Action:      ActionOfferAccept,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "acceptOffer",
	}, h.AcceptOffer)

	r.Post("/v1/riders/me/offers/{offerId}/reject", httpx.Policy{
		Action:      ActionOfferReject,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "rejectOffer",
	}, h.RejectOffer)

	r.Get("/v1/riders/me/assignments/{assignmentId}", httpx.Policy{
		Action:      ActionAssignmentRead,
		Class:       httpx.ClassRead,
		OperationID: "getAssignment",
	}, h.GetAssignment)

	r.Post("/v1/riders/me/assignments/{assignmentId}/transitions", httpx.Policy{
		Action:      ActionAssignmentTransition,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "createAssignmentTransition",
	}, h.CreateTransition)

	r.Post("/v1/riders/me/assignments/{assignmentId}/proof-of-delivery", httpx.Policy{
		Action:      ActionPodSubmit,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "submitProofOfDelivery",
	}, h.SubmitPod)
}
