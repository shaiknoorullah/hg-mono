// Package catalog owns restaurants, menus and the halal certification surface —
// everything a customer browses before there is an order.
//
// Responsibility: restaurant profiles and trading state, menu versions with
// variants and add-ons, search and filtering, and the halal display state that
// gates every customer-facing read path.
//
// Spec:
//
//   - docs/spec/01-platform.md §P-33 (restaurant and dish search), §P-34
//     (filters and halal certification), §P-29 (document lifecycle for
//     certificates)
//   - docs/spec/03-restaurant.md — menu editing, open/closed toggle with
//     heartbeat, the four Canadian onboarding documents
//   - docs/spec/02-customer.md §C-12 — the halal badge and certification panel
//
// Two rules that are easy to get wrong and expensive to fix later:
//
//   - Halal vocabulary is split by audience. Customer-facing payloads carry
//     HalalDisplayState {CERTIFIED, EXPIRING_SOON, EXPIRED, UNVERIFIED}; the
//     admin surface carries HalalCertificateStatus, the lifecycle enum. There is
//     no SELF_DECLARED on the wire at all (decision O-06), so a listing surface
//     cannot render one by accident.
//   - Only CERTIFIED and EXPIRING_SOON are customer-visible. Everything else is
//     404 from every customer read path — not a hidden badge, a 404.
//
// Contract: tags `catalogue` and `halal`. Note the spelling — the contract uses
// the Canadian "catalogue" for the tag while this package is `catalog` to match
// the Go convention of the rest of the tree.
//
// TODO: menu price, availability and ordering changes are instant and
// unreviewed; claim-bearing fields are never auto-approved (decision R-05,
// resolving contradiction #18) — silence must never become consent on a halal
// claim.
package catalog
