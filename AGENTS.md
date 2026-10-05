# AGENTS.md

Read this first. It tells an AI assistant — or a new engineer — what this repository is, what is already decided, and what not to break.

> The nearest `AGENTS.md` wins. `CLAUDE.md` is a symlink to this file.

---

## 1. What this is

**HalalGoes** — a halal food-delivery marketplace for Canada (launch: Ontario, CAD). Customers find and order from **verified halal-certified** restaurants; riders deliver; restaurants manage orders; admins verify certification.

This repo replaces three older ones (`hg-api`, `halal-goes`, `hg-docker`). It is a **from-scratch rebuild**, not a migration — the previous system was never in production, so there is no data to migrate and no traffic to preserve.

**The product's single claim is halal verification.** Everything else is furniture around it. If the seal, the certification panel and the seven-check verification instrument are wrong, nothing else matters.

## 2. Architecture in one picture

```
Traefik  →  hg (ONE Go binary: HTTP + WebSocket, 2 replicas)
                ├── Postgres + PostGIS   ← the only source of truth
                ├── Valkey (Redis)       ← cache, pub/sub, rate limits — DISPOSABLE
                └── Silo (MinIO fork)    ← documents, images — private buckets only
```

A **modular monolith**, not microservices. Packages call each other as functions: no network between them, no serialization, no distributed failure modes, and therefore **no workflow engine**. Temporal is replaced by a `deadline_at` column plus a ticker goroutine.

**Load-bearing rule:** flush Redis at any moment and the system must still be *correct* — just slower. Every Redis bug in the previous system came from violating this.

**Where it runs:** at launch, all of it on one server, with a permanent dev environment beside production; a warm standby is added next month ([hosting and dev environment decisions](docs/decisions/README.md#settled--platform-decisions-owner-2026-10-01)).

## 3. Non-negotiable invariants

Each exists because it was violated in the previous system and cost real money or real safety. Do not weaken one without an entry in `docs/decisions/`.

1. **The server prices every order.** Clients send item IDs and a tip. Never a price. Inbound DTOs may not carry price fields.
2. **Deny by default.** A route is public only if explicitly registered public.
3. **Money is `int64` minor units** — `BIGINT`, columns `*_cents`, branded `Cents` in TypeScript. `numeric`, `money`, `double precision`, `float` are forbidden in monetary paths.
4. **Every non-terminal order state carries `deadline_at`**, enforced by a Postgres `CHECK`. "Waits forever" is unrepresentable.
5. **Authorise then capture.** Capture on restaurant acceptance; reject and timeout *void* the authorisation. There is no refund to fail.
6. **Every order's money decomposes to zero residual** — enforced by an append-only double-entry ledger with a deferred `SUM = 0` trigger.
7. **KYC and certificates live in private buckets** behind short-lived presigned URLs. Never public.
8. **A missing halal field renders no badge** — never an optimistic one. Silence is never consent on a halal claim.
9. **Never red for a halal state.** Red reads as *haram* — a religious ruling the platform does not make. Expired is cool slate: "we can't currently vouch."
10. **Solid green is reserved to `color.halal.*`.** Semantic success is tint-only. Enforced by lint rule L-4.

## 4. Layout

| Path | What |
|---|---|
| `docs/spec/` | **The specification of record** — 198 features, states, rules, acceptance criteria, SOW traceability |
| `docs/decisions/` | Settled decisions, reconciled conflicts, open blockers |
| `docs/design/` | Design-system docs: DTCG tokens, 41 components, patterns, accessibility. [Claude Design](https://claude.ai/artifact/1GwGVZz8Ju9wcz4HfCnzbv) is the source of truth for tokens and components. Redesign: `redesign-constitution.md` (the rules), `design-surface.md` (the approved canvases and every state), `audit/` (the pre-redesign audits, historical) |
| `docs/analysis/legacy-system/` | Forensic analysis of the system being replaced (18 reports) |
| `docs/analysis/base-evaluation/` | Why `ts-monorepo-template` was harvested, not forked |
| `docs/planning/` | The six competing operating models, three judgements, the winner, and the backend module briefs |
| `docs/reports/` | Standalone HTML briefs (open in a browser) |
| `docs/SESSION-REPORT.md` | How this repo came to be, what was decided, what was got wrong |
| `contracts/` | **Single source of truth for every API shape.** OpenAPI + WebSocket + 311 fixtures |
| `packages/api-client/` | Generated TS client. **Hand-editing generated files is forbidden** |
| `packages/ui-native/`, `ui-web/` | 81 components, both themes |
| `services/hg/` | The Go binary |
| `deploy/` | docker compose + Traefik |

**Reading order:** `docs/spec/00-overview.md` → `01-platform.md` (money model, order machine, realtime — read before any domain spec) → domain specs → `docs/decisions/README.md`.

## 5. Commands

```bash
pnpm install
pnpm check                              # contract + fixtures + drift + typecheck — the gate
pnpm -r test
pnpm mock                               # mock API on :4010, WS on /v1/ws
cd services/hg && make up && make migrate && make run
```

**Git hooks** ([`lefthook.yml`](lefthook.yml)) install on `pnpm install`; `pnpm exec lefthook install` re-installs them.
- `commit-msg`: the message starts with `fix|feat|docs|refactor|perf|chore|ci|build|test`, optional `(scope)` and `!`, then `: ` — the same prefixes that label a PR.
- `pre-commit` (staged files only): `gofmt`, and token / API-client drift when `docs/design/tokens.json` or `contracts/openapi.yaml` is staged.
- `pre-push`: lint + tests for the workspace packages changed since `origin/main`; `go test ./...` when `services/hg` changed.
- Emergency skip: `LEFTHOOK=0 git commit …` / `LEFTHOOK=0 git push`. CI runs the same checks, so skipping only moves the failure to the PR.

## 6. How to work here

- **The contract is authoritative.** If a spec, a prompt or a person contradicts `contracts/openapi.yaml`, the contract wins — or the contract changes first, deliberately, and clients regenerate. Never hand-write a type that the generator emits.
- **Every screen implements empty, loading and error.** Happy-path-only screens do not merge.
- **Tests are few and high-value.** Roughly 15–25 that pin invariants — money, auth, the state machine, one end-to-end smoke — not thousands that pin getters. The previous system had more test code than production code and still failed. Coverage is measured, not chased: a PR may not lower the coverage of any file it touches, and only money and safety code (pricing, ledger, the order state machine, auth, payments) has a fixed floor — see `coverage/` and [#118](https://github.com/shaiknoorullah/hg-mono/issues/118).
- **Prefer making a bug unrepresentable over testing for it.** A `CHECK` constraint beats a test; a branded type beats a runtime assert; an unexported brand beats a code review.
- **Fixtures cover every state**, not the happy one — all 14 order states, all four halal states, empty lists, expired certificates, failed payments.
- **Issues, PRs and links follow [`CONTRIBUTING.md`](CONTRIBUTING.md).** Everything found, deferred or in progress is a GitHub issue; one PR does one thing; the title prefix sets the label; internal codes are always written out and linked to their definition.

## 7. State as of the last commit

**Done:** specification (198 features), decisions, API contract (152 operations, 85 enums), generated client, 330 fixtures, mock server.

**Backend: built against today's contract.** All seven domain modules from the [module briefs](docs/planning/backend-modules.md) exist in `services/hg/internal` (auth and identity; catalogue and discovery; cart, quote and orders; payments, ledger and payouts; dispatch; realtime; admin, roles and files), among 23 packages. Every one of the 152 contract operations is validated against a live response by the [conformance gate](services/hg/internal/conformance/COVERAGE.md), and the Go tests run in CI on every PR. The owner's round-2 answers still need contract and backend work ([#182](https://github.com/shaiknoorullah/hg-mono/issues/182), [#183](https://github.com/shaiknoorullah/hg-mono/issues/183), [#184](https://github.com/shaiknoorullah/hg-mono/issues/184)).

**Design: the redesign is approved.** The owner approved the redesigns of all four apps in Claude Design on 1 Oct 2026 ([sign-off](https://github.com/shaiknoorullah/hg-mono/issues/85#issuecomment-5976668489)). The canvases are listed in the [design surface](docs/design/design-surface.md) and the rules are in the [redesign constitution](docs/design/redesign-constitution.md). [Claude Design](https://claude.ai/artifact/1GwGVZz8Ju9wcz4HfCnzbv) is the source of truth for tokens and components; `@hg/ui-web` and `@hg/ui-native` are being rebuilt on shadcn/ui and React Native Reusables to match it ([#109](https://github.com/shaiknoorullah/hg-mono/issues/109), [#110](https://github.com/shaiknoorullah/hg-mono/issues/110), [#111](https://github.com/shaiknoorullah/hg-mono/issues/111)).

**Apps: all four exist and are being rebuilt.** Customer and rider (Expo), restaurant and admin (web) call the API through the generated client, but they predate the redesign. Rebuilding them from the approved canvases: [customer (#87)](https://github.com/shaiknoorullah/hg-mono/issues/87), [rider (#88)](https://github.com/shaiknoorullah/hg-mono/issues/88), [restaurant (#89)](https://github.com/shaiknoorullah/hg-mono/issues/89), [admin (#90)](https://github.com/shaiknoorullah/hg-mono/issues/90). The marketing site is `apps/marketing`.

**Release 1.0: Tuesday 6 Oct 2026**, moved from 1 Oct ([release date](docs/decisions/README.md#launch-scope-and-contract)). What ships: [#103](https://github.com/shaiknoorullah/hg-mono/issues/103); when it is done: [#257](https://github.com/shaiknoorullah/hg-mono/issues/257).

**Production: not set up yet.** It starts on one Contabo Cloud VPS 6 in US-East; the warm standby ([#210](https://github.com/shaiknoorullah/hg-mono/issues/210)) is added next month ([hosting decision](docs/decisions/README.md#settled--platform-decisions-owner-2026-10-01), [hosting plan](https://github.com/shaiknoorullah/hg-mono/issues/207)). A permanent dev environment will run beside production on that server, with its own data, configuration and test-mode keys; only the requirement is settled, and its design awaits the owner's approval ([#235](https://github.com/shaiknoorullah/hg-mono/issues/235)). A live Stripe account ([#56](https://github.com/shaiknoorullah/hg-mono/issues/56)) and real SMS and email ([#59](https://github.com/shaiknoorullah/hg-mono/issues/59)) are still to do. How the platform is built and hosted is in the [platform decisions](docs/decisions/README.md#settled--platform-decisions-owner-2026-10-01): self-hosted open source throughout. The exceptions are email through Resend and maps through Mapbox, which the owner approved, and the services that cannot be self-hosted: Stripe, Apple and Google push delivery, Twilio Verify and the app stores.

**Blocked on the owner** (the [open decisions](docs/decisions/README.md#open--blocking)):
- **[HST supplier position (O-01)](docs/decisions/README.md#open--blocking)**: the registration number is set; whether the platform or each restaurant is the supplier of record is with the accountant.
- **[SMS and OTP sender registration (O-03)](docs/decisions/README.md#open--blocking)**: nobody can sign in without it, and carrier approval takes days to weeks.
- Also undecided: the retention periods and in-app flow for account deletion ([launch scope](docs/decisions/README.md#launch-scope-and-contract)).

Refund liability, launch province and self-declared halal restaurants are [settled](docs/decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1).

## 8. Known gaps

- The compose stack **boots from an empty volume and runs healthy**: Traefik, 2× API, Postgres/PostGIS, Valkey (the Redis-compatible cache) and [Silo, the maintained fork of MinIO](docs/decisions/README.md#settled--platform-decisions-owner-2026-10-01), with `/health` and `/health/ready` returning 200 through the published port. The MinIO images it used to pin can no longer be pulled; Silo and Valkey are pinned by release and digest on Docker Hub, and mirroring them into a registry we control is still to do ([#202](https://github.com/shaiknoorullah/hg-mono/issues/202)).
- No standby server until next month ([#210](https://github.com/shaiknoorullah/hg-mono/issues/210)): a lost production server is rebuilt from backups, hours to a day offline, losing changes since the last off-server backup ([incident runbook](docs/ops/runbook.md)).
- Object storage is more exposed than the [architecture](#2-architecture-in-one-picture) says: the compose file publishes the console and S3 API ports and the media bucket is public-read ([#200](https://github.com/shaiknoorullah/hg-mono/issues/200)), and presigned links are signed with the root user ([#203](https://github.com/shaiknoorullah/hg-mono/issues/203)).
- Notifications (push, SMS and email) go to fake senders; only sign-in codes go through Twilio Verify. Real SMS, and email through Resend: [#59](https://github.com/shaiknoorullah/hg-mono/issues/59).
- Map address search through our API, forwarding to Mapbox, is not in the contract yet ([#179](https://github.com/shaiknoorullah/hg-mono/issues/179)); Mapbox keys are [#57](https://github.com/shaiknoorullah/hg-mono/issues/57).
- Some docs still name hosted SaaS tools that the self-hosted rule replaces: [#199](https://github.com/shaiknoorullah/hg-mono/issues/199).
- The auth module is **built and live**: phone OTP sign-in (WhatsApp/SMS via Twilio Verify), email + password + TOTP for admin/restaurant, the role matrix, and session/refresh. Non-public routes enforce the deny-by-default matrix, not a blanket 401. (Dev has no seeded login account — use `make dev-admin` to provision one.)
- `DependencyReport` in the contract cannot express the configured-vs-actual comparison; the config-reality probe lives on a non-contract `/debug/deps` route until the contract is widened.
- `react-native-svg` is now a dependency of `@hg/ui-native`, used by the `Icon` primitive for Solar product iconography (Sep 2026 — a scoped reversal of the original no-SVG stance). The **halal shield glyph and the four structural glyphs stay `View`-drawn deliberately** ([iconography](docs/design/01-foundations.md#11-iconography)) — the reversal is for product icons only, not the halal instrument.
- ~~Tailwind v4 emits `@media (width >= var(--hg-breakpoint-xl))`; inert.~~ **Fixed (Sep 2026):** the token generator now emits literal breakpoint values (`--breakpoint-md: 768px`), not `var()` refs — the bug affected *all* breakpoints (sm–2xl), not just xl, and silently killed every responsive variant. The generator comment guards against regression.
