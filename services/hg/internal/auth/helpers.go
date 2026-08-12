package auth

import (
	"crypto/rand"
	"encoding/hex"
)

// randSuffix returns a short random hex suffix for de-duplicating slugs. It uses
// crypto/rand so two concurrent registrations do not collide predictably.
func randSuffix() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		// rand.Read failing is effectively fatal; a fixed suffix would still be
		// disambiguated by the account/email unique constraints upstream.
		return "0000"
	}
	return hex.EncodeToString(b)
}
