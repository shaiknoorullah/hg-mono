package files

// Wire DTOs, matching the contract schemas exactly (additionalProperties:false).

// uploadInput is the contract's UploadInput.
type uploadInput struct {
	Purpose     string  `json:"purpose"`
	ContentType string  `json:"content_type"`
	ByteSize    int64   `json:"byte_size"`
	SHA256      string  `json:"sha256"`
	OrderID     *string `json:"order_id"`
}

// presignedUpload is the contract's PresignedUpload.
type presignedUpload struct {
	UploadID        string            `json:"upload_id"`
	URL             string            `json:"url"`
	Method          string            `json:"method"`
	ExpiresAt       string            `json:"expires_at"`
	RequiredHeaders map[string]string `json:"required_headers"`
}

// presignedDownload is the contract's PresignedDownload.
type presignedDownload struct {
	URL       string `json:"url"`
	ExpiresAt string `json:"expires_at"`
}

// storedObject is the contract's StoredObject.
type storedObject struct {
	ID           string  `json:"id"`
	Purpose      string  `json:"purpose"`
	State        string  `json:"state"`
	ContentType  string  `json:"content_type"`
	ByteSize     int64   `json:"byte_size"`
	RejectReason *string `json:"reject_reason"`
}
