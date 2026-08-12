package admin

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// Routes registers the admin module's routes on the shared router. Every route
// carries an explicit Policy with the required Action (deny by default) and the
// contract's operationId. None of these routes is Public: the admin surface is
// authenticated staff only.
//
// Idempotent routes (every mutating admin endpoint per 0.1) set Idempotent so
// the P-37 middleware requires an Idempotency-Key; the claim/replay against
// idempotency_record commits in the handler's transaction and is owned by the
// orders/payments sibling that built that store. TODO(P-37): call the claim in
// each mutating handler's transaction once that helper exists — until then the
// header is required but replay is not yet deduplicated.
func Routes(r *httpx.Router, h *Handler) {
	read := func(action httpx.Action, op string) httpx.Policy {
		return httpx.Policy{Action: action, Class: httpx.ClassRead, OperationID: op}
	}
	write := func(action httpx.Action, op string) httpx.Policy {
		return httpx.Policy{Action: action, Class: httpx.ClassWrite, Idempotent: true, OperationID: op}
	}

	// Staff & RBAC (A-01).
	r.Get("/v1/admin/staff", read(ActionStaffRead, "listStaff"), h.ListStaff)
	r.Post("/v1/admin/staff", write(ActionStaffCreate, "createStaffUser"), h.CreateStaffUser)

	// Restaurant onboarding queue (A-13).
	r.Get("/v1/admin/restaurant-applications", read(ActionRestaurantApplicationRead, "listRestaurantApplications"), h.ListRestaurantApplications)
	r.Post("/v1/admin/restaurant-applications/take-next", write(ActionRestaurantApplicationClaim, "takeNextRestaurantApplication"), h.TakeNextRestaurantApplication)

	// Rider onboarding queue (A-23).
	r.Get("/v1/admin/rider-applications", read(ActionRiderApplicationRead, "listRiderApplications"), h.ListRiderApplications)
	r.Post("/v1/admin/rider-applications/take-next", write(ActionRiderApplicationClaim, "takeNextRiderApplication"), h.TakeNextRiderApplication)

	// Document review (A-14).
	r.Post("/v1/admin/restaurant-documents/{documentId}/review", write(ActionDocumentReview, "reviewRestaurantDocument"), h.ReviewRestaurantDocument)
	r.Post("/v1/admin/rider-documents/{documentId}/review", write(ActionDocumentReview, "reviewRiderDocument"), h.ReviewRiderDocument)

	// The halal seven-check (A-15) — the platform's reason to exist.
	r.Get("/v1/admin/halal-certificates/{certificateId}", read(ActionHalalCertRead, "getHalalCertificate"), h.GetHalalCertificate)
	r.Put("/v1/admin/halal-certificates/{certificateId}/transcription", write(ActionHalalCertTranscribe, "transcribeHalalCertificate"), h.TranscribeHalalCertificate)
	r.Put("/v1/admin/halal-certificates/{certificateId}/checks", write(ActionHalalCertChecks, "recordHalalChecks"), h.RecordHalalChecks)
	r.Post("/v1/admin/halal-certificates/{certificateId}/decision", write(ActionHalalCertDecide, "decideHalalCertificate"), h.DecideHalalCertificate)

	// Halal issuing-body registry (A-16).
	r.Get("/v1/admin/halal-issuing-bodies", read(ActionHalalIssuerRead, "listHalalIssuingBodies"), h.ListHalalIssuingBodies)
	r.Post("/v1/admin/halal-issuing-bodies", write(ActionHalalIssuerPropose, "proposeHalalIssuingBody"), h.ProposeHalalIssuingBody)
	r.Post("/v1/admin/halal-issuing-bodies/{bodyId}/status", write(ActionHalalIssuerSetStatus, "setHalalIssuingBodyStatus"), h.SetHalalIssuingBodyStatus)
}
