package handoff

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// httpxNotFound is the boundary NOT_FOUND code (httpx.CodeNotFound), aliased
// locally so this file reads the same as dispatch/files' error helpers without
// a stutter of "httpx." at every call site below.
const httpxNotFound = httpx.CodeNotFound

// serviceError is a domain error carrying the HTTP status, the contract error
// code and optional details — identical shape to dispatch's, so the handler
// translates it the same way. The service layer never touches
// http.ResponseWriter directly.
type serviceError struct {
	Status  int
	Code    httpx.ErrorCode
	Message string
	Details any
}

func (e *serviceError) Error() string { return string(e.Code) + ": " + e.Message }

func newError(status int, code httpx.ErrorCode, message string, details any) *serviceError {
	return &serviceError{Status: status, Code: code, Message: message, Details: details}
}

// asServiceError reports whether err is a *serviceError.
func asServiceError(err error) (*serviceError, bool) {
	se, ok := err.(*serviceError)
	return se, ok
}
