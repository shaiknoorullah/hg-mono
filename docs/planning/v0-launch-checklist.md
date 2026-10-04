# v0 launch checklist

**Definition of a launchable v0:** a customer in Ontario can find a **verified-halal** restaurant, place and pay for a real order, a restaurant can accept it, a rider can deliver it, and an admin can verify a restaurant's halal certification — all on real infrastructure, with real payments and real sign-in.

Owner tags: **[YOU]** = your decision / vendor / legal (I can't unblock). **[ME]** = engineering, no external dependency. **[BOTH]** = engineering that needs an input from you (a key, an account, a decision).

Status as of this session: the **v0 spine is built and integration-proven** — contract-faithful backend (71 drifts fixed + a conformance gate now covering 70/144 ops, `make check` green end-to-end), the order lifecycle end-to-end, **all 4 apps** UI-verified against the real backend, the **onboarding/halal pipeline proven end-to-end**, and the **first `make up` working**. Bugs the deeper passes surfaced and fixed: an envelope `omitempty` corrupting every `data:null` response platform-wide; the rider go-online 500; a discovery-distance 500; the halal_certificate never being created; the take-next summary/full shape drift; the dispatch race-test flake. Below is what still stands between this and a launchable v0.

**Done this pass (were [ME] items):** onboarding flow end-to-end · conformance coverage 23→70 · dispatch flake fixed · rider app UI re-verified · first `make up`. **Done this pass (the two v0 gaps I'd under-scoped):**
- ✅ **Restaurant go-live wiring** — `DOCUMENTS_APPROVED → PAYOUT_PENDING → MENU_PENDING → ACTIVE` now advances through the real gates (admin doc approval, Connect payout READY, live menu + hours), `account_state` flips to LIVE; the dev stamp is gone. (`a37549e`, tested.)
- ✅ **`EXPIRE_OFFER` / D-15** — the dispatch runner now expires lapsed offers, escalates waves with radius-widening + `NO_RIDER_FOUND` hard stop, and offlines unresponsive riders. (`b26fdd3`, tested.)

**Also done this pass:** ✅ conformance coverage **70 → 144/144** (`e42c61c`, `77c079c`; two more real drifts fixed along the way — HH:MM hours, and earlier the omitempty envelope) · ✅ **oapi-codegen floor** — 431 generated Go types + hermetic git-diff gate in `make check` (`cd6d815`; per-handler adoption is the documented incremental step) · ✅ **null fields** — real media-URL resolver + admin order joins (`190bb9b`). `make check` is green end-to-end (generate-check + fmt + vet + `-race` tests + conformance 144/144).

**Still [ME] (small):** cart price-snapshot migration · adopt the generated contract types per-handler (incremental) · rider `phone_alias` (needs the proxy-number service — overlaps yours-blocked O-03).

---

## 1. Blocked on you (decisions / vendor / legal) — the critical path

- [ ] **[YOU] O-03 — SMS / A2P sign-in.** Nobody can sign in without phone OTP. Today it's a log echo. Need a real provider + A2P 10DLC approval (days–weeks lead time — start first). Twilio creds you gave aren't verified yet. → *Once you hand me verified API creds, wiring is [ME] and small.*
- [ ] **[YOU] O-01 — HST registration + supplier position.** No legal basis to charge tax without it; affects every invoice and payout. With the accountant (message drafted). → *Once decided, the tax/payout wiring is [ME].*
- [ ] **[YOU] O-05 — Launch province(s).** Default Ontario. Gates tax rates + address validation. Confirm.
- [ ] **[YOU] O-06 — Self-declared halal restaurants:** list behind a filter, or hide entirely? Default hide. Product-defining.
- [ ] **[YOU] O-04 — Refund liability allocation** (platform vs restaurant).
- [ ] **[YOU] Stripe live account + Connect** — a real Stripe account, live keys, and Connect onboarding enabled (I run on a fake local Stripe today).
- [ ] **[YOU] Production hosting** — a box/cluster with Docker + a domain/DNS + TLS for Traefik.

## 2. Engineering — mine, no external dependency

- [ ] **[ME] Transactional notification infrastructure (v1 — core UX).** Guaranteed-delivery messages: sign-in OTP + order lifecycle (accepted, captured, rider assigned, arriving, delivered, refund). Build a multi-channel `Notifier` (SMS / push / email / in-app WS) that **generalizes the existing `SMSSender` OTP seam**, on a **River transactional outbox** — the notification job is enqueued in the order's `pgx` transaction, so delivery is atomic with the state change, at-least-once + idempotent, and **Postgres-backed** (a Redis flush can't lose one). Provider failover (Twilio→fallback, FCM/APNs; email has one provider, Resend) + channel escalation (push→SMS) + delivery audit. **Consent-independent** (transactional, not marketing). Fakes for local dev like the fake Stripe. Fully separate from the v2 marketing plane. Spec: `docs/planning/transactional-notifications.md`. _Currently only the OTP echo exists._
- [ ] **[ME] Onboarding flow, end-to-end.** Backend endpoints exist (`register/restaurant`, `documents`, `documents/submit`, `onboarding/status`, `admin/restaurant-applications`, `admin/halal-certificates/*`). Not yet exercised as a flow: restaurant registers → uploads cert → admin runs the seven-check → restaurant is published and appears in discovery. This is the **halal intake** — the source of every verified restaurant. Wire + UI-verify both sides (restaurant-web onboarding, admin verification). *(Independent of O-01/O-03; only needs seeded/real cert data.)*
- [ ] **[ME] Rider app UI re-verify** against the conformant backend (offer → accept → pickup → proof-of-delivery → delivered). Backend lifecycle is proven; the app UI is the one surface not re-verified post-fix.
- [ ] **[ME] Broaden the conformance gate.** 23/144 ops validated centrally today. Add coverage for the reads that need bespoke seeding + the admin/rider write surfaces, so drift can't hide in the uncovered 121.
- [ ] **[ME] App breadth — every screen implements empty/loading/error.** Core flows are verified; sweep the rest (esp. the full admin surface — 27 ops — currently rendering empty states).
- [ ] **[ME] Fix the `dispatch` `TestAcceptIsRaceFree` flake** so `make check` is reliably green (passes in isolation; contends under the full suite).
- [ ] **[ME] oapi-codegen floor (optional but recommended):** generate Go response DTOs from the contract so drift becomes a *compile error*, not just a test failure — the "make it unrepresentable" end-state.
- [ ] **[ME] Fill the contract-valid `null` fields** once their services land: media-URL resolver (logo/menu images), rider proxy-number service (`phone_alias`), cart price-drift snapshot column, admin order joins (delivery_address/rider/dispatch_state).

## 3. Engineering that needs an input from you

- [ ] **[BOTH] Real payments.** Swap the fake Stripe for live Connect once you provide the account + keys (§1). Then re-verify authorise→capture→void→payout with a real (test-mode) card.
- [ ] **[BOTH] Real SMS OTP.** Wire the verified A2P provider (§1 O-03) in place of the log echo; verify a real code arrives on a phone.
- [ ] **[BOTH] Deploy bring-up.** `make up` the full compose stack (Traefik + 2× hg + Postgres/PostGIS + Redis + MinIO) on your host — never done; first run is the real test. Migrations, seed, health, TLS.

## 4. Hardening (before real traffic, after the core)

- [ ] **[ME]** The 15–25 invariant tests green under `make check` on a fresh clone (money, auth, state machine, one e2e smoke).
- [ ] **[ME]** Rate limits, idempotency, and the deadline ticker exercised under load.
- [ ] **[ME]** MinIO bucket privacy + presigned-URL TTLs verified for KYC/cert docs (invariant #7).
- [ ] **[BOTH]** Observability (logs/metrics/traces) wired to wherever you want them.

---

**Bottom line:** the riskiest ~60–70% of v0 — the contract-faithful spine — is done and proven. The remaining v0 work is (a) 3 things blocked on **you** that are on the critical path (SMS, payments account, HST), and (b) engineering **I** can do now (onboarding flow, rider UI, coverage, breadth). **v1** (24 contract operations) is deliberately deferred and not started.
