package files

import (
	"encoding/hex"
	"strconv"
)

// hexDecode decodes a 64-char lowercase hex SHA-256 into bytes, rejecting any
// other length or casing so the stored fingerprint is always well-formed.
func hexDecode(s string) ([]byte, error) {
	if len(s) != 64 {
		return nil, errBadChecksum
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return nil, errBadChecksum
		}
	}
	return hex.DecodeString(s)
}

// itoa renders an int64 without importing fmt at the call site.
func itoa(n int64) string { return strconv.FormatInt(n, 10) }
