---
covers: []
reviewed: 2026-10-04
---

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
| **SMS / A2P sign-in** (O-03) | Twilio A2P 10DLC campaign approval | done — `TwilioSMSSender` built + unit-tested; `HG_SMS_PROVIDER=twilio` + creds flips it on. |
| **Stripe live payments** | a real Stripe account + keys | done — live/fake was already a config gate (`Stripe.Configured()`); confirmed, no code change needed. |
| **HST registration** (O-01) | accountant (registration number + supplier position) | config flip built (`HG_TAX_HST_REGISTRATION_NUMBER`); the receipt-snapshot *writer* that would render it is a separate, not-yet-built module — see runbook. |
| Launch province (O-05), self-declared halal (O-06), refund liability (O-04) | settled in Sep 2026 ([launch decisions](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)) | defaults coded (Ontario / hide / by fault); no flip needed. |

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
- **Restaurant:** profile / hours / settings, payouts, menu editor. Staff management waits: restaurant accounts are owner-only at launch ([staff accounts](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).
- **Admin:** the remaining surfaces — order oversight, disputes, refunds,
  restaurant/rider management, the System page on the readiness check (dependency
  status stays later-version: [launch scope](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).

### Lane 3 — Harden + finish the tail (woven in / after)
- The 15–25 invariant tests as a suite; a security-review pass; observability.
- The small `[ME]` tail: cart price-snapshot migration, per-handler adoption of the
  generated contract types, rider `phone_alias` (overlaps O-03).
- The ~24 deferred **v1** operations, when the v0 surfaces are complete.

## Go-live runbook (what each client answer flips on)

Lane 1 is done: every blocked item below is now a config flip, not an eng sprint.
Each is env-gated in `internal/config` and wired in `cmd/hg/main.go`; boot itself
validates the flip (a half-set provider fails loud, never half-works silently).

### SMS (O-03) — `internal/auth`

Default is `LogSMSSender`: the send is recorded, nothing is delivered (local dev
uses `echoOTP` to print the code so the flow completes without a provider). The
real adapter — `auth.TwilioSMSSender` (`internal/auth/sms_twilio.go`) — is built
and unit-tested today (`internal/auth/sms_twilio_test.go`, mocked `httpDoer`, no
live A2P needed to test it) against the Twilio Messages API
(`POST /2010-04-01/Accounts/{Sid}/Messages.json`).

Flip it on:

| Variable | Required | Notes |
|---|---|---|
| `HG_SMS_PROVIDER` | yes | `log` (default) or `twilio`. Any other value fails boot. |
| `HG_TWILIO_ACCOUNT_SID` | when `twilio` | `AC…` |
| `HG_TWILIO_AUTH_TOKEN` | when `twilio` | Basic-auth secret |
| `HG_TWILIO_FROM_NUMBER` | one of these two | E.164 sender number |
| `HG_TWILIO_MESSAGING_SERVICE_SID` | one of these two | `MG…`; preferred for A2P 10DLC traffic |

`HG_SMS_PROVIDER=twilio` with incomplete credentials refuses to boot
(`internal/config/config.go`) — there is no half-configured state that silently
falls back to the logger. Still waiting on the client: **A2P 10DLC campaign
registration** with Twilio (the longest lead time in the project) — that is a
Twilio-side approval, not an engineering task, and nothing above can be tested
end-to-end against real carriers until it clears. The adapter, its config gate,
and its unit tests do not depend on it.

### Stripe live payments (P-16..P-21) — `internal/payments`

Already gated, verified as-is, no code change needed. `cmd/hg/main.go` selects the
client at boot:

| Variable | Required | Notes |
|---|---|---|
| `HG_STRIPE_SECRET_KEY` | to go live | `sk_test_…` or `sk_live_…`; presence flips `Stripe.Configured()` true |
| `HG_STRIPE_WEBHOOK_SECRET` | to go live | `whsec_…`, for `Stripe-Signature` verification |
| `HG_STRIPE_CONNECT_RETURN_URL` / `HG_STRIPE_CONNECT_REFRESH_URL` | for restaurant onboarding | server-generated AccountLink bases |

Selection logic (`cmd/hg/main.go`): `Configured()` → `payments.NewLiveStripe(...)`
(real SDK). Unconfigured + `HG_ENV=local` → `payments.NewFakeStripe()` (dev-only,
fabricates successful authorisations so orders can be placed without credentials —
never reachable outside local). Unconfigured + non-local → payment mutation routes
answer 503, read paths still work. `Stripe.LiveMode()` (`sk_live_` prefix) is
cross-checked against every inbound webhook's own `livemode` flag
(`internal/payments/webhooks.go`, I-17.3) — a live-mode event can never land on a
test-mode boot or vice versa. No branch here needs to change for go-live: set the
two required variables to the real live-mode values.

### HST registration (O-01) — `internal/orders`, `internal/config`

Tax computation is already correct and provider-independent
(`internal/orders/pricing/tax.go`, P-11): HST/GST/PST rates, the Ontario POS
rebate, and the "one HST line, never GST + PST" receipt shape do not change with
this flip. What was missing was *whose* registration number prints on the
receipt. `contracts/openapi.yaml`'s `Receipt.platform_tax_registration_number` was
already contract-shaped to render "only when configured; a placeholder token is
never printed" — that contract intent is now backed by config:

| Variable | Required | Notes |
|---|---|---|
| `HG_TAX_HST_REGISTRATION_NUMBER` | to print on receipts | the platform's own CRA HST/GST number |
| `HG_TAX_PLATFORM_LEGAL_NAME` | optional | legal entity name printed alongside it |

Both default to `""` (rendered as absent, never a placeholder — I-08 in spirit).
`orders.NewStore(...).WithPlatformTaxInfo(cfg.Tax.HSTRegistrationNumber,
cfg.Tax.PlatformLegalName)` threads the value into the orders module, which owns
`GetOrderReceipt`; `Store.PlatformTaxRegistrationNumber()` /
`.PlatformLegalName()` are the read seam for the receipt-snapshot writer to
consume. **Known gap, not part of this flip:** no code path currently writes the
`order.receipt_snapshot` JSONB column at `COMPLETED` — the receipt-read side
(`GetOrderReceipt`, the DTO with `PlatformTaxRegistrationNumber *string`) is
built and tested, but the writer that assembles and freezes the snapshot at
completion has not been built by any module yet. Setting the env var above is
correct and ready; it has no visible effect until that writer lands. If O-01
resolves "platform is deemed supplier for non-registrant restaurants" rather
than "restaurant remains supplier of record," that changes which party's number
prints on some receipts — a decision, not a config value; note it before the
writer is built.

### Province / self-declared halal / refund liability (O-04, O-05, O-06)

Settled in Sep 2026 as the coded defaults: Ontario only, self-declared halal hidden,
refund liability by fault ([launch decisions](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)).

---

**Recommendation:** Lane 1 first (small, removes the launch-lag risk), then Lane 2 as
the main push with hardening woven in. v1 after the v0 app surfaces are complete.
