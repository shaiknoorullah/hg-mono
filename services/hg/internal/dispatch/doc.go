// Package dispatch owns rider assignment and the geo primitives it rests on.
//
// Responsibility: find riders, offer a delivery in waves, accept race-free, and
// track position. The dispatch machine is *subordinate* to the order machine —
// it may advance an order but it may never cancel one.
//
// Spec: docs/spec/01-platform.md
//
//   - P-30 Canonical geography. There is exactly one location column per
//     locatable entity, of type geography(Point,4326), NOT NULL wherever the
//     entity is operational. The old schema carried a legacy `location POINT`
//     *and* a PostGIS `coords geometry` on both restaurant and rider; creation
//     wrote one and dispatch read the other, so every checkout for a
//     normally-onboarded restaurant died with "Restaurant location not found".
//     geography, not geometry: ST_Distance returns metres and ST_DWithin takes
//     metres, on the spheroid. No degrees-to-kilometres × 111 approximation.
//   - P-31 Distance, duration and ETA
//   - P-32 Rider search and the offer waves
//
// Dispatch wave parameters are deliberately *not* in the contract: the wire
// carries only wave, expires_at and server_time, and clients render the server's
// numbers (contradiction #13). Making them contract constants would repeat the
// mistake of hardcoding fees and ETAs in clients.
//
// Race-free acceptance (D-16 / P-32) is a conditional UPDATE, not a
// read-then-write: Store.AcceptOffer claims the offer, then a single
// `UPDATE dispatch ... WHERE rider_account_id IS NULL AND state IN (...)`
// arbitrates simultaneous accepts — exactly one transaction commits, every
// other gets zero rows and OFFER_ALREADY_TAKEN. Availability moves to
// ON_DELIVERY in the same transaction. There is no Redis on the accept path, so
// it still succeeds with Redis entirely down; restoration after terminal states
// happens in the transition transaction, with ReconcileAvailability as the 60 s
// backstop sweep.
package dispatch
