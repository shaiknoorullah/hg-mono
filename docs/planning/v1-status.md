# v1 status — after the 4-wave ultracode push

_Halal Goes. Consolidated, **personally verified** status (not agent self-report). Aug 2026.
The rule this whole push was held to: report the real state, never a green light I didn't
run myself._

## Verified DONE — backend (the engine runs and is provably correct)

- **9 domain modules built, merged, compiling** on `integration`: auth, catalog, orders,
  payments, dispatch, restaurant, admin, notify, **handoff**.
- **Gate GREEN** (run against live Postgres): `go build ./...`=0, `go vet`=0,
  `generate-check` in-sync (no contract drift / no hand-edited generated files),
  **conformance 152/152 operations validated** (fresh, real per-op PASS incl. the 4 handoff
  ops), **invariant suite 18/18** (server-prices-order, deny-by-default, deadline_at on every
  non-terminal state, ledger SUM=0, authorise→capture/void, atomic notify-in-tx, one e2e smoke).
- **Full compose stack boots from an EMPTY volume and is healthy** — first-ever bring-up:
  Traefik + 2× API + Postgres/PostGIS + Redis + MinIO all up; `/health` and `/health/ready`
  return **200 through the published port**; migrations 0→27 clean.
- **Transactional notifications** = River outbox, enqueued **inside** the order transition tx
  (atomic); customer + restaurant + rider recipients wired. (Marketing plane stays v2, separate.)
- **handoff / chain of custody**: EdDSA-signed QR token `{order_id, seal_id, nonce}` on auth's
  keys; seal-bind (restaurant) / pickup-scan (rider) / delivery-scan (rider) / tamper-report
  (customer); **proofs only** — they call orders to transition (P-14 preserved); nonce replay
  rejected; tamper opens the dispute edge, never auto-fails. **Only the rider scans.**

## DONE — apps (breadth built; compiler-clean + partial runtime)

Four apps carry v1 core + breadth, wired to the generated client + mock, every screen
empty/loading/error, in the Crimson/Solar/glass-adaptive-nav system:
- **customer** (Expo): home, OTP auth, discovery, restaurant detail + halal panel, cart,
  checkout, tracking, order history/reorder, profile, addresses, notifications, ratings.
- **rider** (Expo): OTP, availability, offer stack, navigation, QR scan (handoff), POD-OTP,
  KYC, earnings, profile/docs, history.
- **restaurant** (Vite): auth, onboarding, order queue (accept→capture), menu, hours, settings,
  staff, payouts.
- **admin** (Vite + LyteNyte): auth, the A-15 seven-check instrument, orders grid → order-detail
  (live-map box), cases, queues, dashboards.

All **typecheck/build clean**; booted against the live stack (health-verified). **Not** yet
device-verified for native-only paths (camera/QR, Mapbox needs a dev build + token).

## Buildable tail (small — no external dependency)

- **notify test isolation** — `insertAccount` collides on a reused DB (leftover phone rows);
  give each run unique phones or a fresh DB. Module is correct (passed on the clean boot);
  the test is not hermetic.
- Deeper **app runtime/device verification** + an app-level test net (currently thin).
- Rider **Stripe-Connect payout onboarding** flow (currently a banner stub).
- **Admin live-map** visual verification (needs a Mapbox token).
- Per-handler adoption of the generated contract types (incremental).

## HUMAN-BLOCKED — these gate LAUNCH, not code (only you/the client can unblock)

No amount of further code moves these:
- **O-03 SMS / A2P 10DLC** — nobody can sign in without phone-OTP delivery. **Longest lead time
  — start first.** (The `SMSSender`/notify seam is ready; it's a config flip once approved.)
- **Stripe live account + keys** — real charges. (Live/fake is a `Configured()` gate.)
- **O-01 HST registration** — legal basis to charge tax. (Tax is already computed.)
- **O-04** refund liability · **O-05** launch province (default Ontario) · **O-06** self-declared
  halal (default hide) — product decisions; defaults coded.
- **Real Mapbox token** (your subscription) for live maps.
- **Production hosting** — box/cluster + domain/DNS + TLS for Traefik.

## Honest completion estimate

- **Backend: ~95%** — gate-green, boots as a full stack, contract-complete at 152 ops.
- **Apps: ~60–65%** — breadth built and compiler-clean; runtime/device verification + tests are
  the gap.
- **Shippable v1: ~65–70% by code**, and **launch is blocked on the human items above** — most
  critically A2P sign-in. A running, provably-correct system exists; it cannot yet take a real
  customer through phone sign-in → paid order → HST invoice until those flips land.

## Immediate next (buildable) if the push continues

1. Fix notify test hermeticity; add the app-level test net.
2. Rider Stripe-Connect payout flow; admin live-map with a token.
3. De-risk each human-blocked item into a one-line config flip (Twilio adapter behind the seam,
   Stripe live path, HST number) so the moment the client answers, launch isn't lagged.
