package restaurant

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// decodeStrict JSON-decodes the request body into dst, refusing unknown fields
// (additionalProperties:false from the contract) and trailing content.  It
// returns false and writes 422 VALIDATION_FAILED on any error, so the caller
// should return immediately.
func decodeStrict(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body could not be parsed against the schema.",
			[]httpx.FieldError{{Field: "body", Code: "invalid", Message: err.Error()}})
		return false
	}
	if dec.More() {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body carried trailing content.", nil)
		return false
	}
	return true
}

// decodeStrictOptional decodes an optional body. It returns true (pass) when
// the body is absent or empty, and applies decodeStrict when a body is present.
func decodeStrictOptional(w http.ResponseWriter, r *http.Request, dst any) bool {
	if r.Body == nil || r.ContentLength == 0 {
		return true
	}
	return decodeStrict(w, r, dst)
}
