# What's next

_Status as of Aug 2026. Companion to `v0-launch-checklist.md`._

## Where we are — done and proven

The backend and integration spine is **built, integration-proven, and gated against
regression**:

- **Contract-faithful backend.** 144/144 operations validated against
  `contracts/openapi.yaml` at test time (the conformance harness), pinned so
  coverage can't lapse; plus the oapi-codegen floor for compile-time drift. `make
  check` is green end-to-end.
- **The critical paths work end-to-end**, each verified by running, not self-report:
  customer order → restaurant accept/capture → rider dispatch → delivery →
  DELIVERED; the onboarding → seven-check halal verification → go-live pipeline; the
  D-15 dispatch wave/expiry loop.
- **All four apps talk to the real backend** (customer, restaurant, admin verified
  through the UI; rider through the work-loop). First `make up` works.

What that leaves is **product breadth** (the apps are core-flow slices, not complete
products) and a handful of items **waiting on the client**.

## Blocked on the client (not on engineering)

These gate *launch*, but almost no engineering waits on them — the seams exist, so
each is a config flip when the answer lands (see the runbook below):

| Item | Waiting on | Eng state |
|---|---|---|
| **SMS / A2P sign-in** (O-03) | provider + A2P 10DLC approval | `SMSSender` seam ready; dev uses a logger. Adapter is buildable now. |
| **Stripe live payments** | a real Stripe account + keys | live/fake is a config gate (`Stripe.Configured()`). Flip = env vars. |
| **HST registration + supplier position** (O-01) | accountant | tax is *computed* already; only the registration number + a possible supplier-position branch are pending. |
| Launch province (O-05), self-declared halal (O-06), refund liability (O-04) | product decisions | defaults coded (Ontario / hide / …); flip = config. |

## The plan — three lanes

### Lane 1 — De-risk the blocked items (recommended next; ~1–2 days)
Make every client answer a **config flip, not an eng sprint**, so launch isn't
lagged the moment they respond.
- Build the real **Twilio SMS adapter** behind the existing `SMSSender` seam —
  unit-testable now with a mocked HTTP client (no live creds needed to build it);
  A2P approval → wire-up + env var.
- Confirm + document the **Stripe live path** and the **HST flip** (branch the
  supplier-position logic only if O-01 resolves "platform is deemed supplier").
- Ship a **go-live runbook**: exactly which env var / decision turns each item on.

### Lane 2 — Build the apps out to shippable v0 (the bulk; fully unblocked)
The real remaining product work; none of it waits on the client. Each screen with
empty/loading/error, verified through the UI against the conformant backend.
- **Customer:** OTP auth polish, order history + reorder, profile, saved addresses,
  notifications, ratings.
- **Rider:** onboarding, earnings/payouts, profile + documents, delivery history.
- **Restaurant:** profile / hours / settings, staff management, payouts, menu editor.
- **Admin:** the remaining surfaces — order oversight, disputes, refunds,
  restaurant/rider management, dependency/system dashboards.

### Lane 3 — Harden + finish the tail (woven in / after)
- The 15–25 invariant tests as a suite; a security-review pass; observability.
- The small `[ME]` tail: cart price-snapshot migration, per-handler adoption of the
  generated contract types, rider `phone_alias` (overlaps O-03).
- The ~24 deferred **v1** operations, when the v0 surfaces are complete.

## Go-live runbook (what each client answer flips on)

_To be filled in as part of Lane 1 — the exact env vars, migrations, and decision
branches that turn each blocked item live, so the flip is mechanical and reviewed._

- **SMS:** `HG_SMS_PROVIDER=twilio` + `HG_TWILIO_*` creds → real OTP delivery (swap
  the logger seam). A2P sender ID must be registered first.
- **Stripe:** `HG_STRIPE_SECRET_KEY` + `HG_STRIPE_WEBHOOK_SECRET` → `Configured()`
  true → live gateway (auth/capture/void/payout + the signed webhook path).
- **HST:** set the platform registration number; if O-01 = "platform is deemed
  supplier for non-registrants", enable the supplier-of-record invoicing branch.
- **Province / halal listing:** `HG_LAUNCH_PROVINCES`, the self-declared-halal filter
  flag.

---

**Recommendation:** Lane 1 first (small, removes the launch-lag risk), then Lane 2 as
the main push with hardening woven in. v1 after the v0 app surfaces are complete.
