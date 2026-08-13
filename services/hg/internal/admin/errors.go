package admin

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// Error codes this module can raise. Every constant here must exist in the
// contract's ErrorCode enum (contracts/openapi.yaml) — contract first, then code.
const (
	CodeValidationFailed httpx.ErrorCode = "VALIDATION_FAILED"
	CodeNotFound         httpx.ErrorCode = "NOT_FOUND"
	CodeForbidden        httpx.ErrorCode = "FORBIDDEN"

	// Staff / RBAC.
	CodeEmailInUse        httpx.ErrorCode = "EMAIL_IN_USE"
	CodeSelfApprovalNotOK httpx.ErrorCode = "SELF_APPROVAL_FORBIDDEN"

	// Onboarding queues.
	CodeReviewLockLost     httpx.ErrorCode = "REVIEW_LOCK_LOST"
	CodeAlreadyDecided     httpx.ErrorCode = "ALREADY_DECIDED"
	CodePreconditionNotMet httpx.ErrorCode = "PRECONDITION_NOT_MET"
	CodeAgeNotMet          httpx.ErrorCode = "AGE_REQUIREMENT_NOT_MET"
	CodeItemDeleted        httpx.ErrorCode = "ITEM_DELETED"

	// Halal.
	CodeCheckNotOverridable httpx.ErrorCode = "CHECK_NOT_OVERRIDABLE"
	CodeChecklistIncomplete httpx.ErrorCode = "CHECKLIST_INCOMPLETE"
	CodeCheckFailed         httpx.ErrorCode = "CHECK_FAILED"
	CodeDuplicateCert       httpx.ErrorCode = "DUPLICATE_CERTIFICATE"
	CodeHalalCertRequired   httpx.ErrorCode = "HALAL_CERTIFICATE_REQUIRED"

	// Order oversight (A-38).
	CodeIllegalTransition httpx.ErrorCode = "ILLEGAL_TRANSITION"
)
