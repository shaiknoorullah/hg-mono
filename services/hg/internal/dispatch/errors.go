package dispatch

import (
	"errors"
	"net/http"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// serviceError is a domain error carrying the HTTP status, the contract error
// code and optional details. The handler translates it verbatim into the error
// envelope, so the service layer never touches http.ResponseWriter.
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

// errWaveNotOpen is CreateWave refusing a wave: another replica already ran
// this wave number, or the search is over (a rider took the order, or it ended
// in NO_RIDER_FOUND). The caller has nothing to do; it is not a failure.
var errWaveNotOpen = errors.New("dispatch: wave already run or search not open")

// asServiceError reports whether err is a *serviceError.
func asServiceError(err error) (*serviceError, bool) {
	se, ok := err.(*serviceError)
	return se, ok
}

var (
	errOfferNotFound      = newError(http.StatusNotFound, httpx.CodeNotFound, "No such offer.", nil)
	errAssignmentNotFound = newError(http.StatusNotFound, httpx.CodeNotFound, "No such assignment.", nil)
)
