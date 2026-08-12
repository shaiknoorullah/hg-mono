package files

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// Actions this module declares. The role→action mapping is the auth sibling's
// matrix; here we only name the action each route requires (deny by default).
const (
	// ActionUploadCreate guards createUpload. Held by every human-facing role
	// (customers, riders, restaurant staff, admins) — the object's purpose then
	// narrows what each may actually store.
	ActionUploadCreate httpx.Action = "upload.create"
	// ActionDocumentDownload guards createDocumentDownloadUrl. Partners reach it
	// through ownership; the global kyc_document.download action lets an admin
	// fetch any document, audited.
	ActionDocumentDownload httpx.Action = "kyc_document.download"
)

// Routes registers the uploads/documents routes. Neither is Public: an upload
// URL and a document URL are both authenticated, and ownership is enforced in
// the handler/repository for the partner path.
//
// createUpload is MONEY-free but mutating, so it is Idempotent (P-37) and its
// Idempotency-Key is required; the claim/replay against idempotency_record is
// the store sibling's helper. TODO(P-37): dedupe replays in the handler tx.
func Routes(r *httpx.Router, h *Handler) {
	r.Post("/v1/uploads", httpx.Policy{
		Action:      ActionUploadCreate,
		Class:       httpx.ClassUpload,
		Idempotent:  true,
		OperationID: "createUpload",
	}, h.CreateUpload)

	r.Get("/v1/documents/{documentId}/download-url", httpx.Policy{
		Action:      ActionDocumentDownload,
		Class:       httpx.ClassRead,
		OperationID: "createDocumentDownloadUrl",
	}, h.CreateDocumentDownloadURL)
}
