package admin

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// Error codes this module can raise. Every constant here must exist in the
// contract's ErrorCode enum (contracts/openapi.yaml) — contract first, then code.
const (
	CodeValidationFailed httpx.ErrorCode = "VALIDATION_FAILED"
	CodeInvalidEnumValue httpx.ErrorCode = "INVALID_ENUM_VALUE"
	CodeNotFound         httpx.ErrorCode = "NOT_FOUND"
	CodeForbidden        httpx.ErrorCode = "FORBIDDEN"
	// CodeAccountNotActive refuses a staff member whose account or staff
	// profile is no longer active, though their session's token is still valid
	// (store_handover.go, overrideActorTx).
	CodeAccountNotActive httpx.ErrorCode = "ACCOUNT_NOT_ACTIVE"

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
	// CodeMFARequired refuses a handover override from a session that did not
	// sign in with two-step sign-in (handler_handover.go).
	CodeMFARequired httpx.ErrorCode = "MFA_REQUIRED"

	// Menu (A-19).
	CodeCategoryNameTaken  httpx.ErrorCode = "CATEGORY_NAME_TAKEN"
	CodePriceOutOfRange    httpx.ErrorCode = "PRICE_OUT_OF_RANGE"
	CodeFieldNotWritable   httpx.ErrorCode = "FIELD_NOT_WRITABLE"
	CodeMenuVersionPending httpx.ErrorCode = "MENU_VERSION_PENDING"
)
