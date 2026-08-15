// Package handoff owns the tamper-evident package-seal chain of custody: two
// guarantees layered on top of the order machine (P-14), which stays the sole
// writer of order.state (orders owns state; handoff owns proof).
//
//  1. Identity  — the rider picked up and delivered the *correct* order.
//  2. Integrity — the seal applied at the kitchen was still intact at the door.
//
// The QR a rider scans encodes an EdDSA-signed token {order_id, seal_id, nonce}
// minted with auth's signing keys (P-04) — offline-verifiable, unforgeable, and
// bound to one order so it cannot be moved to another. The physical seal is
// printed once, at binding, and its QR is scanned twice — once at pickup, once
// at delivery — so the stored nonce is scoped per proof type
// ("<token nonce>:PICKUP" / "...:DELIVERY"): a genuine replay of the *same*
// step is a Postgres UNIQUE constraint violation (handoff_event_nonce_unique,
// migration 00027), never a runtime check that might be skipped, while the
// legitimate pickup-then-delivery pair is two distinct keys.
//
// Only the rider ever scans, at both pickup and delivery — the customer's proof
// of delivery is the OTP they hold (internal/dispatch, D-21), a separate
// requirement. The customer's only handoff-adjacent action is filing a tamper
// report after the fact; it never auto-fails the order or the payment — it
// appends the scan-and-photo trail and opens the existing dispute flow
// (A-33/A-35), which decides the money outcome.
//
// This package never writes order.state directly (P-14): a valid proof calls
// through the OrderLifecycle seam to the orders module, exactly the pattern
// internal/dispatch already uses for its own PICKED_UP/DELIVERED bridge. Unlike
// that bridge, a lifecycle failure here is surfaced to the caller rather than
// swallowed — advancing the order *is* the point of these four endpoints, so a
// caller must know when it did not happen, even though the handoff evidence
// itself (the scan, the photo) is already durably recorded either way.
//
// Handoff photo and geo evidence travel through internal/files exactly like
// proof of delivery does: the client presigns and confirms an upload with
// purpose POD first (no HANDOFF-specific bucket exists in the merged schema),
// and this package only ever validates a `READY`, `POD`-purpose stored_object
// id scoped to the order — never a client-asserted filename or bucket.
//
// Spec: docs/design/handoff-verification.md · migrations/00027_handoff.sql.
package handoff
