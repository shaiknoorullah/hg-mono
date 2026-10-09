package devworld

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base32"
	"fmt"
	"strings"
)

// PersonaPassword is the shared password for every email persona in the local
// world. It is a development credential, not a production secret.
const PersonaPassword = "Seed!2026"

// AdminEmail is the local super-admin persona.
const AdminEmail = "admin-seed@seed.hg"

// BismillahRestaurantID is the live certified restaurant apps and scenarios
// address by a stable id.
const BismillahRestaurantID = "b0000000-0000-4000-8000-000000000208"

// Identity is one stable persona. The same account id, email and phone are
// literals in the SQL under migrations/devworld.
type Identity struct {
	Slug         string
	AccountID    string
	RestaurantID string
	Email        string
	Phone        string
}

// World is the persona list reset recreates. Ids stay the same across resets.
var World = []Identity{
	{Slug: "admin-seed", AccountID: "a0000000-0000-4000-8000-000000000001", Email: AdminEmail},
	{Slug: "support-seed", AccountID: "a0000000-0000-4000-8000-000000000002", Email: "support-seed@seed.hg"},
	{Slug: "ops-admin", AccountID: "a0000000-0000-4000-8000-000000000003", Email: "ops-admin@seed.hg"},
	{Slug: "amina", AccountID: "a0000000-0000-4000-8000-000000000101", Phone: "+15550100101"},
	{Slug: "nour", AccountID: "a0000000-0000-4000-8000-000000000102", Phone: "+15550100102"},
	{Slug: "rider-sim", AccountID: "a0000000-0000-4000-8000-000000000151", Phone: "+15550100151"},
	{Slug: "rider-docs", AccountID: "a0000000-0000-4000-8000-000000000152", Phone: "+15550100152"},
	{Slug: "rider-rejected", AccountID: "a0000000-0000-4000-8000-000000000153", Phone: "+15550100153"},
	{Slug: "rider-registered", AccountID: "a0000000-0000-4000-8000-000000000154", Phone: "+15550100154"},
	{Slug: "fresh", AccountID: "a0000000-0000-4000-8000-000000000201", RestaurantID: "b0000000-0000-4000-8000-000000000201", Email: "fresh@seed.hg"},
	{Slug: "profile", AccountID: "a0000000-0000-4000-8000-000000000202", RestaurantID: "b0000000-0000-4000-8000-000000000202", Email: "profile@seed.hg"},
	{Slug: "docs-todo", AccountID: "a0000000-0000-4000-8000-000000000203", RestaurantID: "b0000000-0000-4000-8000-000000000203", Email: "docs-todo@seed.hg"},
	{Slug: "docs-review", AccountID: "a0000000-0000-4000-8000-000000000204", RestaurantID: "b0000000-0000-4000-8000-000000000204", Email: "docs-review@seed.hg"},
	{Slug: "docs-rejected", AccountID: "a0000000-0000-4000-8000-000000000205", RestaurantID: "b0000000-0000-4000-8000-000000000205", Email: "docs-rejected@seed.hg"},
	{Slug: "payout", AccountID: "a0000000-0000-4000-8000-000000000206", RestaurantID: "b0000000-0000-4000-8000-000000000206", Email: "payout@seed.hg"},
	{Slug: "menu", AccountID: "a0000000-0000-4000-8000-000000000207", RestaurantID: "b0000000-0000-4000-8000-000000000207", Email: "menu@seed.hg"},
	{Slug: "bismillah-grill", AccountID: "a0000000-0000-4000-8000-000000000208", RestaurantID: BismillahRestaurantID, Email: "bismillah-grill@seed.hg"},
	{Slug: "expiring-halal", AccountID: "a0000000-0000-4000-8000-000000000209", RestaurantID: "b0000000-0000-4000-8000-000000000209", Email: "expiring-halal@seed.hg"},
	{Slug: "expired-halal", AccountID: "a0000000-0000-4000-8000-000000000210", RestaurantID: "b0000000-0000-4000-8000-000000000210", Email: "expired-halal@seed.hg"},
	{Slug: "paused", AccountID: "a0000000-0000-4000-8000-000000000211", RestaurantID: "b0000000-0000-4000-8000-000000000211", Email: "paused@seed.hg"},
	{Slug: "suspended", AccountID: "a0000000-0000-4000-8000-000000000212", RestaurantID: "b0000000-0000-4000-8000-000000000212", Email: "suspended@seed.hg"},
}

// AdminTOTPSecret derives a local staff authenticator secret from the email.
// The same input always yields the same secret, so a reset can re-enrol it
// without storing the secret in the repository. Reset enrols every persona in
// Staff.
func AdminTOTPSecret(email string) (string, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" {
		return "", fmt.Errorf("devworld: totp email is empty")
	}
	mac := hmac.New(sha256.New, []byte("devworld-local-totp-v1"))
	_, _ = mac.Write([]byte(email))
	sum := mac.Sum(nil)
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(sum[:20])
	return secret, nil
}
