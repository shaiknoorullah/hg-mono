package files

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Error codes this module raises; each must exist in the contract ErrorCode enum.
const (
	codeValidationFailed httpx.ErrorCode = "VALIDATION_FAILED"
	codeNotFound         httpx.ErrorCode = "NOT_FOUND"
	codePayloadTooLarge  httpx.ErrorCode = "PAYLOAD_TOO_LARGE"
	codeContentType      httpx.ErrorCode = "CONTENT_TYPE_MISMATCH"
	codeChecksum         httpx.ErrorCode = "CHECKSUM_MISMATCH"
	codeImageTooSmall    httpx.ErrorCode = "IMAGE_TOO_SMALL"
)

// Handler serves the uploads/documents operations (P-28).
type Handler struct {
	repo *Repo
}

// NewHandler builds the files handler.
func NewHandler(repo *Repo) *Handler { return &Handler{repo: repo} }

// actorFrom builds the audit actor from the verified principal (identity from
// the session, never the body).
func actorFrom(r *http.Request) Actor {
	p := httpx.PrincipalFrom(r.Context())
	roles := make([]string, 0, len(p.Roles))
	for _, role := range p.Roles {
		roles = append(roles, string(role))
	}
	return Actor{
		AccountID: p.AccountID,
		Roles:     roles,
		SessionID: p.SessionID,
		RequestID: httpx.RequestIDFrom(r.Context()),
		UserAgent: r.Header.Get("User-Agent"),
	}
}

// CreateUpload implements createUpload (P-28). The client declares what it will
// upload; the server validates purpose/content-type/size against the role, then
// binds the signature to exactly that.
func (h *Handler) CreateUpload(w http.ResponseWriter, r *http.Request) {
	var in uploadInput
	if !decodeJSON(w, r, &in) {
		return
	}
	p := Purpose(in.Purpose)
	if !p.Valid() {
		fieldFail(w, r, "purpose", "purpose must be one a client may upload for")
		return
	}
	if _, ok := extFor(p, in.ContentType); !ok {
		fieldFail(w, r, "content_type", "content type not accepted for this purpose")
		return
	}
	if in.ByteSize < 1 {
		fieldFail(w, r, "byte_size", "byte_size must be at least 1")
		return
	}
	if max := maxSizeFor(p); in.ByteSize > max {
		httpx.Fail(w, r, http.StatusRequestEntityTooLarge, codePayloadTooLarge,
			"The declared size exceeds the cap for this purpose.",
			map[string]any{"max_bytes": max})
		return
	}
	if !validSHA256(in.SHA256) {
		fieldFail(w, r, "sha256", "sha256 must be 64 lowercase hex characters")
		return
	}
	if p == PurposePOD && (in.OrderID == nil || *in.OrderID == "") {
		fieldFail(w, r, "order_id", "order_id is required for POD uploads")
		return
	}

	actor := actorFrom(r)
	inputs := keyInputs{accountID: actor.AccountID}
	if in.OrderID != nil {
		inputs.orderID = *in.OrderID
	}
	// KYC/menu subjects are resolved from the caller's own scope by the sibling
	// that owns onboarding; a generic uploader keys KYC under the account until
	// the document is attached. For KYC the subject is the caller's account.
	if p == PurposeKYC {
		inputs.subjectType = "RIDER"
		inputs.subjectID = actor.AccountID
		inputs.docType = "GENERIC"
	}

	res, err := h.repo.AllocateUpload(r.Context(), actor, p, inputs, in.ContentType, in.ByteSize, in.SHA256)
	if err != nil {
		switch {
		case errors.Is(err, errBadContentType):
			fieldFail(w, r, "content_type", "content type not accepted for this purpose")
		case errors.Is(err, errBadChecksum):
			fieldFail(w, r, "sha256", "sha256 must be 64 lowercase hex characters")
		case errors.Is(err, errBadPurpose):
			fieldFail(w, r, "purpose", "purpose not allowed")
		case errors.Is(err, errNotDelivering):
			fieldFail(w, r, "order_id", "order_id must be an order you are delivering")
		default:
			h.failInternal(w, r, err)
		}
		return
	}
	httpx.Respond(w, r, http.StatusCreated, presignedUpload{
		UploadID:        res.UploadID,
		URL:             res.URL,
		Method:          "PUT",
		ExpiresAt:       httpx.Timestamp(res.ExpiresAt),
		RequiredHeaders: res.RequiredHeaders,
	})
}

// CreateDocumentDownloadURL implements createDocumentDownloadUrl (P-28): a
// 120-second attachment URL, ownership or the global download action required,
// and the issuance audited. Another partner's document is 404 with no URL.
func (h *Handler) CreateDocumentDownloadURL(w http.ResponseWriter, r *http.Request) {
	documentID := chi.URLParam(r, "documentId")
	p := httpx.PrincipalFrom(r.Context())
	canReadAny := p.HasRole(httpx.RoleAdmin) || p.HasRole(httpx.RoleSuperAdmin)

	res, err := h.repo.DownloadURL(r.Context(), actorFrom(r), documentID, canReadAny)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, codeNotFound, "No such document.", nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, presignedDownload{
		URL:       res.URL,
		ExpiresAt: httpx.Timestamp(res.ExpiresAt),
	})
}

// ConfirmUpload implements confirmUpload (P-28): the server HEADs the object,
// verifies size, content type and SHA-256, sniffs the magic bytes (a .pdf that
// is really something else is rejected and deleted), enqueues a KYC virus scan,
// and sets state=READY. Only the owner (or an admin) may confirm; another
// partner's upload is 404. A verification failure is a 422 with the specific
// reason; an unwired object store is an honest 503, never a fabricated READY.
func (h *Handler) ConfirmUpload(w http.ResponseWriter, r *http.Request) {
	uploadID := chi.URLParam(r, "uploadId")
	p := httpx.PrincipalFrom(r.Context())
	canConfirmAny := p.HasRole(httpx.RoleAdmin) || p.HasRole(httpx.RoleSuperAdmin)

	out, err := h.repo.ConfirmUpload(r.Context(), actorFrom(r), uploadID, canConfirmAny)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httpx.Fail(w, r, http.StatusNotFound, codeNotFound, "No such upload.", nil)
		case errors.Is(err, errContentType):
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeContentType,
				"The uploaded bytes do not match the declared content type.", nil)
		case errors.Is(err, errChecksum):
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeChecksum,
				"The uploaded bytes do not match the declared size or checksum.", nil)
		case errors.Is(err, errImageTooSmall):
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeImageTooSmall,
				"The uploaded image is below the minimum size for a document scan.", nil)
		case errors.Is(err, errAlreadyRejected):
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeChecksum,
				"The object failed verification and cannot be confirmed.", nil)
		case errors.Is(err, errNotConfigured):
			httpx.Fail(w, r, http.StatusServiceUnavailable, httpx.CodeServiceUnavailable,
				"The object store is not configured; the upload cannot be verified.", nil)
		default:
			h.failInternal(w, r, err)
		}
		return
	}
	httpx.Respond(w, r, http.StatusOK, storedObject{
		ID:           out.ID,
		Purpose:      out.Purpose,
		State:        out.State,
		ContentType:  out.ContentType,
		ByteSize:     out.ByteSize,
		RejectReason: out.RejectReason,
	})
}

func (h *Handler) failInternal(w http.ResponseWriter, r *http.Request, err error) {
	httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
		"The server failed to process this request.", nil)
	_ = err
}

// --- small helpers ---

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"The request body could not be parsed against the schema.",
			[]httpx.FieldError{{Field: "body", Code: "invalid", Message: err.Error()}})
		return false
	}
	return true
}

func fieldFail(w http.ResponseWriter, r *http.Request, field, msg string) {
	httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed, msg,
		[]httpx.FieldError{{Field: field, Code: "invalid", Message: msg}})
}

func validSHA256(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}
