// Package orders owns the cart, the quote, and the 14-state order machine.
//
// Responsibility: pricing an order (the server prices everything — the client
// never sends a price), creating it, and advancing it through its states with a
// deadline on every non-terminal state.
//
// Spec: docs/spec/01-platform.md
//
//   - P-09 Canonical price computation. The quote is a *persisted row*; checkout
//     accepts a quote_id and nothing money-shaped, and the server re-executes
//     Quote() and answers 409 QUOTE_STALE with the new quote embedded on any
//     difference. Nothing signed by the server is ever echoed back by a client
//     (contradiction #17).
//   - P-10 The fee breakdown the customer sees
//   - P-11 Canadian sales tax, effective-dated, place-of-supply driven
//   - P-12 Rounding: round_half_up, symmetric away from zero, so a full refund
//     reverses exactly (contradiction #4)
//   - P-14 The 14-state OrderState machine. It is the *only* order enum; the
//     customer and restaurant vocabularies are display mappings and never appear
//     on the wire (contradiction #9). Rider assignment is the subordinate
//     dispatch machine, which may advance an order but may never cancel it.
//   - P-15 Deadlines. G-5: every non-terminal row carries deadline_at NOT NULL
//     with a declared timeout action, enforced by a Postgres CHECK. "Waits
//     forever" is unrepresentable.
//   - P-36 Validation and the response envelope
//
// Money rules that bind every line of this package: int64 minor units only, no
// float anywhere in a monetary path (G-2), and no inbound DTO carries a price
// (G-3) — the sole exception is tip_cents on createQuote.
//
// Launch timeouts (docs/spec/00-overview.md): CREATED 15 min, AUTHORIZED 60 s,
// RESTAURANT_PENDING 180 s (decision R-04, resolving the customer spec's 300 s),
// PREPARING prep ETA + 10 min, READY_FOR_PICKUP 15 min, PICKED_UP 75 min — and
// PICKED_UP never auto-delivers.
//
// TODO: one active order per customer — createOrder answers 409
// ACTIVE_ORDER_EXISTS (contradiction #24); cart lines are 1–20 (contradiction #21).
package orders
