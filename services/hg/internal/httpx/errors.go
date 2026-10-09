package httpx

// ErrorCode is a member of the contract's ErrorCode enum
// (contracts/openapi.yaml, 144 members, all SCREAMING_SNAKE_CASE).
//
// Clients branch on the code and never on the message. Only the boundary codes
// this package can itself emit are declared here; domain modules declare their
// own next to the handler that raises them. Every constant added must exist in
// the contract enum — contract first, then code.
type ErrorCode string

const (
	CodeInternalError          ErrorCode = "INTERNAL_ERROR"
	CodeNotFound               ErrorCode = "NOT_FOUND"
	CodeForbidden              ErrorCode = "FORBIDDEN"
	CodeAuthenticationRequired ErrorCode = "AUTHENTICATION_REQUIRED"
	CodeMethodNotAllowed       ErrorCode = "METHOD_NOT_ALLOWED"
	CodeUnsupportedMediaType   ErrorCode = "UNSUPPORTED_MEDIA_TYPE"
	CodePayloadTooLarge        ErrorCode = "PAYLOAD_TOO_LARGE"
	CodeValidationFailed       ErrorCode = "VALIDATION_FAILED"
	CodeRateLimited            ErrorCode = "RATE_LIMITED"
	CodeIdempotencyKeyRequired ErrorCode = "IDEMPOTENCY_KEY_REQUIRED"
	CodeIdempotencyKeyReuse    ErrorCode = "IDEMPOTENCY_KEY_REUSE"
	CodeIdempotencyInProgress  ErrorCode = "IDEMPOTENCY_IN_PROGRESS"
	CodeServiceUnavailable     ErrorCode = "SERVICE_UNAVAILABLE"
	CodeOriginNotAllowed       ErrorCode = "ORIGIN_NOT_ALLOWED"
	CodeRateLimiterUnavailable ErrorCode = "RATE_LIMITER_UNAVAILABLE"
	CodeUpstreamTimeout        ErrorCode = "UPSTREAM_TIMEOUT"
	// CodeTimeout: the server could not do the work in time and did nothing,
	// e.g. every password-hashing slot stayed taken (503 + Retry-After).
	CodeTimeout                ErrorCode = "TIMEOUT"
	CodeFeatureNotAvailableYet ErrorCode = "FEATURE_NOT_AVAILABLE_YET"
)

// FieldError is the documented shape of error.details for VALIDATION_FAILED
// (contract schema FieldError).
type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}
