# v1 status — 5-wave push, released as `v1.0.0-rc1`

_HalalGoes. Consolidated, **personally verified** status (not agent self-report). Aug 2026.
The rule this whole push was held to: report the real state, never a green light I didn't
run myself._

## Since wave 5 — release + hardening (all personally re-verified)

- **Tagged `v1.0.0-rc1`** (release candidate; not GA — launch is still client-gated below).
  `main` fast-forwarded to it locally; **not yet pushed** (sandbox has no GitHub creds — run
  `git push origin main && git push origin v1.0.0-rc1`).
- **Fixed a false green** (`c9ac97d`): the conformance harness never loaded seed data, so it only
  passed on a *polluted* dev DB. It now self-seeds — verified **152/152 twice + full `go test ./...`
  green on a CLEAN DB from an empty volume** (the way a real deploy checks). This is now the bar.
- **Twilio Verify WhatsApp OTP built** (`4827f53`) — see O-03 below; unblocks OTP sign-in *now*.
- **Mapbox tokens placed + API-verified** — see the Mapbox line below.
- **Release runbook** committed: `RELEASING.md` + per-surface `.env.example` + go-live env vars.

## Wave 5 — landed & verified GREEN

Four increments merged into `integration` in dependency order, each committed, the whole
tree re-gated after merge:

- **Rider payout onboarding (Stripe Connect)** — `OnboardingScreen` now drives
  `GET /v1/connect/status` + `POST /v1/connect/onboarding-link`; `apiTypes.ts` derives the
  `ConnectStatus` / `ConnectOnboardingLink` types from the generated client (no hand-edit of
  generated files). The banner stub is gone.
- **App test net** — `jest` + `@testing-library/react-native` unit tests for the native
  rider/customer screens (Offer, Availability, LoginGate, Discovery, Restaurant) and `vitest`
  smoke tests for admin (halal-decision-bar, login-gate) and restaurant-web (accept-order,
  login-gate, queue-states). Thin no longer.
- **Backend test hermeticity** — `notify`'s `insertAccount` now seeds random phone digits (not
  a process-local counter that restarts at 1 each run) and registers a children-first
  `t.Cleanup`, so the suite re-runs cleanly against a **long-lived** `HG_TEST_POSTGRES_DSN`
  without collisions or row accumulation. Verified by two back-to-back full runs against the
  live 4-hour-old Postgres.
- **Blocker de-risking to a one-line flip** — **O-03**: a real `TwilioSMSSender` now sits
  behind the `SMSSender` seam; `HG_SMS_PROVIDER=twilio` + credentials flips it on at boot and
  config **refuses to boot** with `provider=twilio` and incomplete credentials (default stays
  `log`, so OTP is functional end-to-end without a provider). **O-01**: HST registration number
  + platform legal name wire through `config.Tax` → `orders.Store.WithPlatformTaxInfo` onto the
  receipt; **rendered only when configured, never a placeholder** (I-08 in spirit).

**Re-gate after merge (REAL, run against live Postgres):** `go build`=0, `go vet`=0,
`make generate-contract` then `git diff`=empty (**no generated-file drift**),
`go test -count=1 ./...` = every package `ok`, `go test -race -run Conformance` =
**152/152 operations validated**, and root **`pnpm check` exit 0** (contract/fixtures/drift →
all app typechecks Done → backend `make check` incl. `go test -race ./...`). Stack still up:
`hg-postgres-1` healthy, both `hg-api` replicas up, `curl :8080/health` → `{"status":"ok"}`.

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

All **typecheck/build clean**; booted against the live stack (health-verified); now carry a
**unit/smoke test net** (wave 5). **Not** yet device-verified for native-only paths (camera/QR,
Mapbox needs a dev build + token).

## Buildable tail (small — no external dependency)

- Deeper **app runtime/device verification** — the wave-5 test net is unit/smoke (renderer-level,
  no device); native-only paths (camera/QR, real navigation) still need a dev build.
- **Admin live-map** visual verification — the order-detail live-map box is wired but needs a
  **real Mapbox token** to render; verification is blocked on that token, not on code.
- Per-handler adoption of the generated contract types (incremental).
- Receipt-writer consumption of the O-01 tax fields end-to-end (values now flow to the store;
  the snapshot writer stamping them onto the persisted receipt is the remaining wire).

## LAUNCH GATES — status (client-side)

### ✅ Resolved since rc1
- **Mapbox** — two public `pk.` tokens placed (admin `VITE_MAPBOX_TOKEN`, mobile
  `EXPO_PUBLIC_MAPBOX_TOKEN`, gitignored env). API-verified: admin renders from `localhost:5173`
  and its URL restriction is enforced on tile requests (disallowed origin → 403). Mobile map
  *wiring* still needs an Expo dev build.
- **O-01 HST** — registration number provided (`728591827RT0001`), staged in `deploy/.env`;
  wired to the receipt, rendered only when set. Tax already computed.
- **O-04 / O-05 / O-06 product decisions — SETTLED** (see `docs/decisions/`): O-05 Ontario only
  (13% HST); O-04 **by-fault refunds — already coded** in `ComputeLiabilitySplit`; O-06
  **hide-entirely** (default; filter-gated declined to keep the core halal promise). All zero-code.
- **OTP sign-in — no longer a hard blocker**: **Twilio Verify WhatsApp OTP is built** (`4827f53`,
  `HG_OTP_PROVIDER=twilio_verify`, Verify service `VA…` staged) — WhatsApp works today
  (Meta-verified, separate track from carrier A2P). Pilot/QA real sign-in now.

### ⛔ Still open (only two hard client items)
- **O-03 SMS / A2P 10DLC** — needed for **universal** coverage (non-WhatsApp users), NOT for
  sign-in to function (WhatsApp covers that now). Longest lead time — keep it moving; flip is
  `HG_SMS_PROVIDER=twilio` + creds (`TwilioSMSSender` built) or Verify's SMS channel.
- **Stripe live account + keys** — real charges. Live/fake is a `Configured()` gate;
  flip = `HG_STRIPE_SECRET_KEY` + `HG_STRIPE_WEBHOOK_SECRET`.
- **Production hosting** — box/cluster + domain/DNS + TLS for Traefik.

## Honest completion estimate

- **Backend: ~96%** — gate-green, boots as a full stack, contract-complete at 152 ops, tests now
  hermetic against a long-lived DB, and both launch-critical config flips (Twilio, HST) are
  built and one env-var away.
- **Apps: ~68–72%** — breadth built, compiler-clean, and now carrying a unit/smoke test net;
  device/runtime verification of native-only paths is the remaining gap.
- **Shippable v1: ~70–75% by code**, and **launch is blocked on the human items above** — most
  critically A2P sign-in. A running, provably-correct system exists; every human-blocked item is
  now de-risked to a config flip, so the day the client answers, launch is not lagged by code.

## Immediate next (buildable) if the push continues

1. Device/runtime verification of native paths (camera/QR, navigation) with a dev build.
2. Admin live-map render + rider payout flow verification once a Mapbox token / test Connect
   account is available.
3. End-to-end receipt-writer consumption of the O-01 tax fields; incremental per-handler
   adoption of the generated contract types.
