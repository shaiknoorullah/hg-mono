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
                ├── Redis                ← cache, pub/sub, rate limits — DISPOSABLE
                └── MinIO                ← documents, images — private buckets only
```

A **modular monolith**, not microservices. Packages call each other as functions: no network between them, no serialization, no distributed failure modes, and therefore **no workflow engine**. Temporal is replaced by a `deadline_at` column plus a ticker goroutine.

**Load-bearing rule:** flush Redis at any moment and the system must still be *correct* — just slower. Every Redis bug in the previous system came from violating this.

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
| `docs/design/` | Design system: DTCG tokens, 41 components, patterns, accessibility |
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

**Done:** specification (198 features), decisions, design system, API contract (144 operations, 80 enums), generated client, 311 fixtures, mock server, 81 components. Component review happens in the [UI/UX rework](https://github.com/shaiknoorullah/hg-mono/milestone/16).

**In progress:** the Go backend. Skeleton, compose stack and the 91-table schema have landed. The seven domain modules are **not started** — briefs ready to dispatch in `docs/planning/backend-modules.md`.

**Not started:** the four apps (customer, rider, restaurant web, admin web).

**Blocked on a human** — see `docs/decisions/README.md`:
- **O-01 HST registration** — no legal basis to charge tax without it (accountant)
- **O-03 SMS / A2P registration** — nobody can sign in without phone OTP; longest lead time in the project
- O-04 refund liability allocation · O-05 launch province (default Ontario) · O-06 self-declared halal listing (default: hide)

## 8. Known gaps

- The compose stack **boots from an empty volume and runs healthy** — Traefik + 2× API + Postgres/PostGIS + Redis + MinIO; `/health` and `/health/ready` return 200 through the published port. First bring-up is done, not pending.
- The auth module is **built and live**: phone OTP sign-in (WhatsApp/SMS via Twilio Verify), email + password + TOTP for admin/restaurant, the role matrix, and session/refresh. Non-public routes enforce the deny-by-default matrix, not a blanket 401. (Dev has no seeded login account — use `make dev-admin` to provision one.)
- `DependencyReport` in the contract cannot express the configured-vs-actual comparison; the config-reality probe lives on a non-contract `/debug/deps` route until the contract is widened.
- `react-native-svg` is now a dependency of `@hg/ui-native`, used by the `Icon` primitive for Solar product iconography (Sep 2026 — a scoped reversal of the original no-SVG stance). The **halal shield glyph and the four structural glyphs stay `View`-drawn deliberately** (`docs/design/01-foundations.md §11`) — the reversal is for product icons only, not the halal instrument.
- ~~Tailwind v4 emits `@media (width >= var(--hg-breakpoint-xl))`; inert.~~ **Fixed (Sep 2026):** the token generator now emits literal breakpoint values (`--breakpoint-md: 768px`), not `var()` refs — the bug affected *all* breakpoints (sm–2xl), not just xl, and silently killed every responsive variant. The generator comment guards against regression.
