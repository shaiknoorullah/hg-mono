# Halal Goes — v1 Wave 3 Integration Report

_Date: 2026-08-15 · Branch: `integration` · Head: `6614f30`_

Written to the standard of the repo's AGENTS.md: **claim only what was observed
by running the real gate.** Every "verified" line below was reproduced in the
main `integration` tree against a **freshly-migrated** live Postgres — not a
self-report, and (this wave's headline) not against the polluted long-lived dev
database earlier waves quietly leaned on.

---

## 1. What this wave was

Merge three backend increments into `integration` in dependency order, reconcile
the contract + regenerated clients, keep migrations monotonic, run the real
gate, and — for the first time — bring the **whole compose stack** up from an
empty volume and prove it serves.

**Finding on arrival:** the three increments were _uncommitted working-tree
changes_ inside their worktrees (`wf_e21ea575-b33-1..3`), each branched from
`integration` HEAD (b33-1 from `main`, one commit behind). They were almost
perfectly disjoint:

| Worktree | Increment | Touched |
|---|---|---|
| b33-1 | **handoff** | one new migration (`00024_handoff.sql`) — package-seal + append-only `handoff_event` chain of custody |
| b33-2 | **contract-gaps** | `contracts/openapi.yaml` (+4 ops), regenerated TS + Go types, 4 handlers, 2 migrations, fixtures, conformance |
| b33-3 | **notify-wiring** | `cmd/hg/main.go` only — restaurant + rider recipients in the order-lifecycle seam |

---

## 2. What landed

### Merge order & migration renumbering

Both b33-1 and b33-2 authored a migration numbered **00025** (handoff was
authored against `main`, before `00024_river_outbox` existed; contract-gaps
added `00025_ratings` + `00026_restaurant_staff_profile`). Left as-is this is a
collision and non-monotonic. Resolved by renumbering handoff to **`00027`**, so
the final order is monotonic:

```
00024_river_outbox  →  00025_ratings  →  00026_restaurant_staff_profile  →  00027_handoff
```

Applied as four commits in dependency order:

| Commit | Increment | What |
|---|---|---|
| `901e088` | handoff | `package_seal` + `handoff_event` (00027). Replay-unrepresentable via `UNIQUE(seal_id, nonce)`; photos/geo as private-bucket `stored_object` (invariant #7). No Go module yet — schema only, module brief still pending. |
| `40a0f4e` | contract-gaps | +4 operations (**144 → 148**): `getOrderRating`/`submitOrderRating` (durable food+rider ratings, replacing an in-memory state) and `listRestaurantStaff`/`createRestaurantStaffUser` (restaurant-scoped roster). |
| `cf855a5` | notify-wiring | `RESTAURANT_PENDING` fans `NotifyOrderPlaced` to every live RESTAURANT-scoped staff account; `READY_FOR_PICKUP` notifies the order's live assignment's rider — both enqueued in the transition tx (invariant #4). |
| `6614f30` | fixtures fix | see §5 — makes the conformance fixtures self-contained on a clean DB. |

### Contract reconciliation (never hand-edited)

The contract source (`openapi.yaml`) was merged, then **both** generated
artefacts were regenerated from it and confirmed byte-identical to what b33-2
had committed:

- `pnpm generate` → `packages/api-client/src/generated/openapi.d.ts` (+307 lines)
- `make generate-contract` → `internal/contract/types.gen.go` (+314 lines)

`pnpm generate:check` and `make generate-check` both pass — the checked-in
generated files match a fresh regeneration exactly, so nothing was hand-edited.

---

## 3. The real backend gate (from `services/hg`, live Postgres, DSN exported)

```
go build ./...          →  BUILD OK
go vet ./...            →  VET OK
make generate-check     →  exit 0 (types.gen.go matches regeneration)
go test ./...           →  every package ok, 0 failures
go test -run Conformance -v ./internal/conformance/...
```

Conformance — real per-op PASS lines, e.g.:

```
--- PASS: TestConformance_OrderRating/getOrderRating_unrated
--- PASS: TestConformance_OrderRating/submitOrderRating          (PUT  /v1/orders/{id}/rating → 200)
--- PASS: TestConformance_OrderRating/getOrderRating_rated
--- PASS: TestConformance_RestaurantStaff/listRestaurantStaff    (GET  /v1/restaurant/staff   → 200)
--- PASS: TestConformance_RestaurantStaff/createRestaurantStaffUser (POST /v1/restaurant/staff → 409)
--- PASS: TestConformance_Payments_RefundWrites/issueRefund      (POST /v1/admin/refunds      → 201)
--- PASS: TestConformance_MoreFiles_CatalogDiscovery/createCertificateViewUrl
...
conformance: validated 148/148 contract operations (see COVERAGE.md)
ok  github.com/.../internal/conformance
```

**148/148** — the new higher total (was 144), all four new operations covered.

### Root `pnpm check` — green

`validate:contract` · `validate:fixtures` · `generate:check` · `generate:tokens:check`
· `lint` · `typecheck` (all 12 apps/packages `Done`) · `check:backend`
(`make check`: vet, generate-check, `go test -race ./...` all `ok`, conformance `ok`).

---

## 4. First full compose bring-up (the stack had never been fully up)

`make down-hard` (destroy stale volumes) → `make up` → `make migrate`. Real outcome:

**deploy_status: UP.** All six services running:

```
hg-traefik-1   Up (healthy)   :8080->80, :8081->8080
hg-api-1       Up
hg-api-2       Up
hg-postgres-1  Up (healthy)   :5432
hg-redis-1     Up (healthy)   :6379
hg-minio-1     Up (healthy)   :9000-9001
```

Migrations applied cleanly **0 → 27 from an empty volume**, including the
`00023_grants_and_lints` gate that RAISEs on any `numeric` money or second
location column — so handoff's `geography(Point,4326)` and the ratings/staff
money columns are lint-clean.

Health checks through Traefik on the published port:

```
GET /health        → 200  {"data":{"status":"ok","version":"dev",...}}
GET /health/ready  → 200  {"ready":true, deps: postgres/redis/minio all ready}
GET /v1/config/public → 200  {"currency":"CAD","served_provinces":["ON"],...}   (real read)
```

`GET /v1/restaurants` returns **401** — correct: auth stubs still deny-by-default
(CLAUDE.md §8), so authenticated reads are unreachable over HTTP until the auth
module lands. The read surface was instead proven end-to-end by the conformance
harness, which injects a test principal in-process.

### One honest wrinkle: first-boot ordering race

On the very first `make up`, both api replicas **crash-looped once** (`exit 1`):
they require River's tables (`river_queue`, `river_leader`), but `api` `depends_on`
Postgres being _healthy_, not on `migrate` having _run_. api booted against an
empty schema, died, and the restart policy recovered it the instant `make migrate`
created the tables (`"River client started"`, `"routes registered total:152"`,
`"listening addr :8080"`). It is self-healing but not clean — see §6.

---

## 5. The finding that matters: the gate was never clean-room before

Bringing the stack up from an empty volume surfaced that **several conformance
ops only ever passed because the long-lived dev database was polluted** with data
from prior sessions. On a truly fresh DB they failed, and this wave fixed the
fixtures to be self-contained (`6614f30`):

1. **`orders` deadline sweep failed** — 11 stale `"order"` rows carried
   `deadline_action = 'EXPIRE_OFFER'`, an action name **that no longer exists in
   the code** (current constants are `OFFER_RESTAURANT` / `RESTAURANT_TIMEOUT`).
   254 orders had accumulated across sessions. A whole-table sweep choked on the
   unknown action and starved the test's own order out of its batch. Pure stale
   data — cleared by the fresh volume.
2. **fixtures.sql referenced a rider account it never created** (`fxRiderID`, a
   runtime v7 UUID from a prior rider registration) — FK-failed the whole
   transaction on a clean DB, so _nothing_ seeded. Now seeds the rider + profile.
3. **The entire restaurant portal 404'd** — no `RESTAURANT_MANAGER` grant linked
   the harness's actor to the restaurant. Now seeds `fxRestaurantManagerID`.
4. **Admin writes 500'd** — `fxSuperAdminID` (the FK actor behind refund audit,
   issuing-body `decided_by`, certificate `verified_by`) was never seeded.
5. **Every customer read was a C-13 404** — the fixture restaurant's `halal_status`
   defaulted to `UNVERIFIED`, failing the visibility gate. Now `CERTIFIED`.

None of these were caused by the three merged increments; the increments merely
made the first clean bring-up happen. Earlier waves' "real gate" was real — but
run against a database that had quietly become a shared fixture. It is now
reproducible from an empty volume.

---

## 6. Remaining for a true v1

Backend-side, honestly:

- **Compose boot ordering.** api should not start until migrations have run (a
  one-shot `migrate` gate in the dependency graph, or api retrying river-client
  start instead of `fatal`). Today it self-heals via restart policy; that is
  luck, not design.
- **`make seed` is still broken** — `seed.sql`'s `\ir` relative includes don't
  resolve through the piped stdin the Makefile uses. Worked around by
  `docker cp`-ing the seed dir into the container and running by file path.
  Needs a real fix so a fresh operator can seed in one command.
- **Handoff is schema-only.** `00027_handoff.sql` landed the tables; the handoff
  Go module (QR mint/verify, scan endpoints, tamper→dispute linkage) is not
  written. No contract ops for it yet.
- **Auth stubs still deny everything over HTTP** (intentional, CLAUDE.md §8) — no
  end-to-end authenticated request path exists until the auth module lands. Every
  authenticated surface is currently proven only in-process by the conformance
  harness.
- **The four apps are not wired to a live backend** — they typecheck and render
  against the mock; none has been run against `:8080`.
- **Human blockers unchanged** — O-01 HST registration, O-03 SMS/A2P (nobody can
  sign in without phone OTP), O-04/05/06 (`docs/decisions/README.md`).

## 7. Candid completion estimate

**Backend contract surface: ~95%.** 148/148 operations conformance-verified
against live Postgres; the modular monolith builds, vets, tests, and now boots
as a full stack from empty. What's left there is a **schema-only handoff module**
and **operational polish** (boot ordering, seeding), not core domain gaps.

**A shippable v1: ~55–60%.** The engine runs and is provably correct; the two
things that actually gate a customer placing a real order — a working **auth /
phone-OTP** path (blocked on O-03, the longest lead item in the project) and the
**four apps talking to the live API instead of the mock** — are both still ahead.
Neither is verified by anything in this wave.

_Everything in §3 and §4 was reproduced in the `integration` tree at `6614f30`
against a Postgres migrated 0→27 from an empty volume._
