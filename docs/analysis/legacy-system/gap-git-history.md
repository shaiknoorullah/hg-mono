# Git History Analysis — Halal Goes Platform (hg-api, halal-goes, hg-docker)

Analysis date: 2026-08-09. All commands read-only against the checked-out branches
(`claude/fleet-agents-repo-analysis-4rqpjt`, which contains `main` in all three repos).
All dates below are commit author dates (mixed +0400/+0530 timezones, quoted as recorded).

---

## 1. hg-api — 7 commits, 6 days of visible life, deliberately truncated history

### Full commit list (`git log --all --stat --date=iso`)

| Commit | Date | Author | Subject | Changes |
|---|---|---|---|---|
| 86c52a7 | 2025-10-05 14:30:53 +0530 | Shaik Noorullah | feat(@hg/api): update all endpoints | **Initial squash commit** — entire codebase lands at once (~250+ files: NestJS app, Prisma schema + 9 migrations back-dated to 2025-09-18, Temporal workflows, notifications gateway, `API v1.0.10.json`, `API v1.2.23.json`, PLAN.md, .env.example, Dockerfile, pnpm-lock) |
| e776cbc | 2025-10-05 14:58:47 +0530 | Shaik Noorullah | chore(release): v1.2.23 | .release-it.json, CHANGELOG, Dockerfile, package.json |
| c058829 | 2025-10-05 15:01:23 +0530 | Shaik Noorullah | chore(release): v1.2.24 | CHANGELOG + version bump only |
| accc0af | 2025-10-05 15:04:42 +0530 | Shaik Noorullah | chore(release): v1.2.23 *(again — version rolled back)* | .release-it.json, CHANGELOG, package.json |
| 182a5f4 | 2025-10-05 15:08:21 +0530 | Shaik Noorullah | chore(release): v1.2.25 | CHANGELOG + version bump only |
| 8f4e127 | 2025-10-11 22:49:43 +0530 | Shaik Noorullah | fix(services/checkout): fixes checkouts worker not being registered | `api/src/services/checkout/checkout.module.ts` (−5/+2) |
| 4302f6b | 2025-10-11 22:58:21 +0530 | Shaik Noorullah | chore(release): v1.2.26 | CHANGELOG + version bump — **HEAD, repo silent thereafter** |

- **No git tags exist** (`git tag -l` is empty), despite RELEASE.md describing a release-it flow that creates tags `v1.2.x` and pushes Docker images `${DOCKER_USERNAME}/halalgoes-api:{version,latest}`. The tags/images were evidently created against a *different* (private/origin) repository, or stripped when this copy was published.
- Branches: only `main` + the analysis branch. No feature branches, no PRs.

### Diff v1.2.23 → HEAD (what 1.2.24–1.2.26 actually changed)

`git diff --stat e776cbc HEAD`:
```
api/.release-it.json                         |  8 ++++----
api/CHANGELOG.md                             | 12 ++++++++++++
api/package.json                             |  2 +-
api/src/services/checkout/checkout.module.ts |  7 ++-----
```
The **only functional change across four releases (1.2.24, 1.2.23-redo, 1.2.25, 1.2.26) is a 5-line fix in checkout.module.ts** registering the checkout Temporal worker. 1.2.24 and 1.2.25 are pure version bumps; the second "v1.2.23" commit corrects a mis-numbered release. The CHANGELOG confirms: 1.2.25/1.2.24/1.2.23 entries have no listed changes; 1.2.26 lists only the checkout fix.

### Auth-provenance verdict: /auth NEVER existed in hg-api's available history

Evidence, exhaustive:
1. `git log --all -S "auth/otp"` → **zero commits**.
2. `git log --all -S "AuthModule"` / `-S "auth.controller"` → **zero commits**.
3. `git log --all --diff-filter=D --name-only` → **zero deleted files ever** — nothing was removed in this history, so auth code was not stripped post-hoc *within these 7 commits*.
4. `git log --all -S "better-auth"` → matches only the initial squash 86c52a7, and only in three places:
   - `api/package.json:52` — `"better-auth": "^1.3.13"` (declared dependency, never imported)
   - `api/pnpm-lock.yaml` (lockfile entry for the same)
   - `PLAN.md:10` (install command) and `PLAN.md:350-352` — **"### 13.2 Add authentication integration — Implement better-auth integration"**, i.e. an explicit *future task*.
5. Both bundled Hoppscotch collections have **no Auth folder**: v1.0.10 folders = [Users, Riders, Restaurants, Carts, Feed, Payments, Pricing, Orders, Admin]; v1.2.23 adds only [Ratings]. Zero requests match auth/otp/login/onboard.

Conclusion: within everything this repo has ever recorded, authentication was *planned* (dependency declared, PLAN.md task 13.2) but **never implemented**. The caveat is the squash itself: 86c52a7 compresses all pre-2025-10-05 evolution (including whatever produced collection v1.0.10 and the 2025-09-18-dated Prisma migrations), so a private ancestor repo could contain more — but the /auth/* endpoints frontends consume from 2026-01-28 onward postdate this repo's HEAD by 3.5 months and therefore **cannot come from any version of this codebase as published**.

### Hoppscotch collection ↔ history mapping

| Collection | Where | What history explains |
|---|---|---|
| API v1.0.10 | hg-api root (in initial commit) | **Nothing** — v1.0.10 (2,302 lines, 9 folders) predates the repo; the evolution v1.0.10 → v1.2.23 (+Ratings folder, ~2,000 lines of new requests) happened in the missing pre-history |
| API v1.2.23 | hg-api root (in initial commit) | Snapshot at repo birth; matches package.json 1.2.23 |
| API v1.2.25 | hg-docker (single commit, 2025-10-05 15:59) | Identical line count (4,293) to v1.2.23 — consistent with 1.2.24/1.2.25 being no-op version bumps made 51–55 minutes earlier the same afternoon |

---

## 2. halal-goes — 291 commits, 2025-03-10 → 2026-02-04, 84 merges

### Contributors (`git shortlog -sne --all`)

| Commits | Identity | Role (inferred) |
|---|---|---|
| 128 + 67 | Aaqeb11 / Aaqeb ahmed nawaz `aaqebahmed@gmail.com` | Lead frontend dev **and** primary PR merger (users, rider, admin-web, restaurant-web, repo tooling) |
| 44 + 7 + 5 | zeezz7 / Azeezz `abdulaziz2537@gmail.com` | admin-web, restaurant-web, users UI; secondary merger |
| 30 + 6 | Mohammed Abid Nafi / abid-websleak `abid.nafi04@gmail.com` | auth package, rider backend integration; left activity ~Oct 2025 |
| 4 | Shaik Noorullah `shaiknooru247@gmail.com` | **Backend owner** — only 4 frontend commits, all 2026-02-02, all fixing auth/Stripe-onboarding state — i.e. the person who wrote hg-api appears in the frontend repo exactly when the new private backend's auth/onboarding was being wired in |

Branch naming: `{dev}websleak/hal-NNN` → PR → `frontend-merging` (integration branch) → periodic bulk PRs `frontend-merging` → `main` (e.g. PRs #101, #106–108, #111, #113, #115, #119, #122, #135). "websleak" suggests an agency (Websleak) doing frontend work for Shaik Noorullah's backend.

### Per-app first/last commit dates

| App | First commit | Last commit | Status |
|---|---|---|---|
| apps/users | 3e49d8a **2025-03-21** "init expo users app" | 6b74062 **2026-02-02** hydration/store sync fix | Active; Supabase→halalgoes auth 2026-01-28 |
| apps/rider | files appear via abid/aaqeb work Aug–Sep 2025 (standardized path commits 2025-09-16/20; rider auth cdeed78 2025-08-20) | 641aed1 **2026-02-04** onboarding docs + status | Active; most recent work in repo |
| apps/restaurant (mobile) | fdd1dd0 **2025-08-18** | bcd594c **2025-10-02** | **Abandoned early Oct 2025** — superseded by restaurant-web; excluded from CI builds |
| apps/restaurant-web | f2499a0 **2025-09-25** "complete restaurant web application with authentication and core management" | 48be59f **2026-02-04** | Active |
| apps/admin-web | d59d808/ea3d824 **2025-09-16** | 48be59f **2026-02-04** | Active |
| apps/web | f36a81f **2025-08-14** (PR #58, hal-102) | same commit | **Abandoned** — Turborepo boilerplate, touched exactly once |
| apps/docs | f36a81f **2025-08-14** | 55dc01a 2025-09-24 (repo-wide babel fix only) | **Abandoned** — boilerplate |
| packages/auth | df19971 **2025-09-12** "supabase init is in package now" | ca66783 **2026-01-29** "replace supabase authflow to halalgoes auth" | Active but **excluded from CI** (see below) |

### CI / pr-workflow history (all 2025-11-20, all Aaqeb11)

1. 42b6caf — add `ci.yml` "for validating and build for smoother integration"
2. 5152e56 — add `frontend-merging` branch to workflow triggers
3. 8bb738a — "remove packages not requrired by the workflow": build filter becomes `--filter="./packages/*" --filter="!./packages/auth" --filter="!./packages/ui" --filter="!./packages/database" --filter="!./apps/users" --filter="!./apps/rider" --filter="!./apps/restaurant"` — **packages/auth excluded from CI build the same day CI was born**, with no recorded reason beyond "not required"; the practical reading is it didn't build cleanly and nobody fixed it
4. 8f13584 — split out separate PR-validator workflow (`pr-workflow.yml`)
5. b205f37 — fix pr-workflow "by removing the condition"
6. f1a0fb0 — **delete ci.yml entirely** "for simplicity" (build CI lived <14 hours); only the lightweight `pr-workflow.yml` survives to HEAD, still carrying the `!./packages/auth` exclusion at line 45

### Backend-integration timeline (the critical evidence chain)

**Phase A — Supabase era + first prod-URL contact (Aug–Sep 2025):**
- 2025-08-20 cdeed78: rider auth (Supabase) + form submission
- 2025-09-12 df19971: Supabase auth centralized into `packages/auth`
- 2025-09-24 7842a45: "add auth package" wired into apps
- 2025-09-27→10-02: users app integrates user/address/feed/cart/payments APIs (36c137b, 2a145c5, 9b5e829, bcd594c)
- **2025-09-30 dd913bf**: rider app calls `http://api.halalgoes.com/riders` — the production domain is serving the API **5 days before hg-api's first commit even exists** (proof the real backend predates and outlives the published hg-api snapshot)

**Phase B — window overlapping hg-api's visible life (2025-10-05 → 10-11):**
- 2025-10-07 06d4a69..166b57c (abid): "integrate backend" ×3 (hal-133)
- 2025-10-08 9bf0dd3 (Aaqeb): "integrate and test prod apis"; c26e75c/472143e "fix: auth flow"
- 2025-10-09 94277b6: "revert: auth" — auth integration attempts churning *while hg-api had no auth*
- 2025-10-11: hg-api v1.2.26 = backend repo's last visible commit

**Phase C — frontends outrun the published backend (2025-10-13 → 2026-01):**
- 2025-10-13→15: websocket order flows in users, rider, restaurant-web (79b089c, a1ad4a7, 5d5b913, ef297ca, 1155e61 "rest apis integrated" — api.halalgoes.com)
- 2025-10-20→21 8c66b30, 9ed6b61: "new supabase for **simulating** approval" — rider/restaurant approval mocked client-side because the backend lacked it
- 2025-11-03→05: `98.130.76.223` (raw backend IP) enters users .env.example (f3c2121), admin/restaurant-web (6003974, ffc934e)
- 2025-11-13 18bb681/835c977/af8dd4e: restaurant-web websockets against 98.130.76.223
- 2025-11-18 fcf37df: "Auth and Fixes"
- 2025-12-06/25, 2026-01-03/06: version bumps (Next 15.5.7, React 19.1.2, Expo 52→53), admin/restaurant-web pages

**Phase D — the halalgoes auth cutover (2026-01-28 → 02-04), 3.5 months after hg-api HEAD:**
- **2026-01-28 3a51004** (hal-171, marked BREAKING CHANGE): users app + packages/auth replace Supabase with halalgoes auth — `/auth/otp/request`, `/auth/otp/verify`, `/auth/register`, `/auth/refresh`, `/auth/logout`, plus `/auth/rider/*` variants — none of which exist in hg-api
- **2026-01-29 ca66783** (hal-173): rider app same migration; a9a8784 adds envs
- **2026-02-02 8420aad** (hal-172, zeezz7): admin-web/restaurant-web "new register, verification, login and onboarding flows" — deletes the Next.js `/app/api/*` proxy routes and creates direct clients for `BASE_URL = https://api.halalgoes.com` with `/auth/admin/login`, `/auth/admin/refresh`, **`/admin/refunds` (+details/analytics), `/admin/disputes` (+status/resolve/analytics), `/admin/settlements` (+details/retry)** — an entire refunds/disputes/settlements admin surface absent from hg-api and from every Hoppscotch collection
- 2026-02-02 cdeaf97/455a630/fe374e3/6ee76c6 (**Shaik Noorullah**, the backend author, committing to the frontend repo): Stripe onboarding redirect/hydration/completion fixes, parallel Stripe onboarding — implies matching backend onboarding endpoints exist privately
- **2026-02-04 d6620ca/641aed1** (hal-176): rider onboarding docs upload URL endpoint against api.halalgoes.com; b7a57cd = final merge PR #135 (HEAD)

### Frontend-vs-backend recency conclusion

hg-api HEAD: 2025-10-11. halal-goes HEAD: 2026-02-04 — **116 days later**. In that window frontends adopted, tested, and shipped against endpoints that hg-api has never contained in any commit: the entire `/auth/*` family (OTP, register, refresh, logout, rider and admin variants), Stripe restaurant onboarding, rider document upload/onboarding-status, and `/admin/{refunds,disputes,settlements}` with analytics. The production host (api.halalgoes.com / 98.130.76.223) was already live before hg-api's first commit and kept evolving after its last. **Verdict: the published hg-api is a truncated, frozen snapshot (v1.2.23–v1.2.26) of a private backend that continued development for at least four more months; the authoritative backend code is not in any of the three repos.**

### Linear ticket → feature mapping (from branch names + commit subjects)

52 distinct tickets appear (hal-102…hal-176, plus typo hal-1458 ≈ hal-145/148). Key ones:

| Ticket | Dev | Feature |
|---|---|---|
| hal-102 | abid | Monorepo apps import incl. apps/web, apps/docs (Aug 14) |
| hal-104/106/107/108 | aaqeb/aziz/abid | restaurant & rider mobile UX (splash, env, letsSetup, image clarity) |
| hal-110/114/115/117 | aaqeb/aziz | users app nativewind/expo-router/zustand refactor; rider structure standardization; user screens |
| hal-118–122, 125–126 | all | admin-web creation, rider store/backend util, google-maps screens, merge-conflict cleanups |
| hal-128/130/131 | aaqeb/abid | users API integration (feed/cart/payments); tanstack-query+axios; update-user |
| hal-133/135 | abid | rider "integrate backend" + auth-flow fixes (Oct 7–8) |
| hal-134/138/139 | aaqeb/abid | order rejection/cancel flow; REST APIs integrated; google maps |
| hal-141/142/143 | aziz/aaqeb | rider mock data; document rejection/approval pages (admin); restaurant-web supabase |
| hal-147/148/150/151 | aziz/aaqeb | admin & restaurant-web flows; checkout endpoint fix, getRider, websocket hook |
| hal-153/154/155/156 | aaqeb/aziz | user update API; restaurant-web supabase/auth env fixes; hardcoded phone removal; "Auth and Fixes" |
| hal-157–161 | aaqeb | search/pagination; CI workflows (add + trim + delete); admin-web build fixes |
| hal-163/164/165/167 | aziz/aaqeb | restaurant fixes; not-found/upcoming pages; admin-web restaurant tab; Expo 53 + users carousel |
| **hal-171** | aaqeb | **users: Supabase → halalgoes /auth/otp (BREAKING)** |
| **hal-172** | aziz | **admin/restaurant-web: register/verify/login/onboarding + refunds/disputes/settlements clients** |
| **hal-173** | aaqeb | **rider: Supabase → halalgoes auth** |
| hal-174/175 | aaqeb | admin-web type fixes; users hydration/store-sync |
| **hal-176** | aaqeb | **rider onboarding docs upload + status (final feature, Feb 4)** |

---

## 3. hg-docker — single commit

- f5cc012, **2025-10-05 15:59:23 +0530**, Shaik Noorullah, "docs(order-api): update order api integration docs" — the whole repo in one commit: docker-compose.yml (PostGIS 17, PgBouncer, 5× Redis incl. sentinel, RedisInsight, pgAdmin, MinIO — **infrastructure only, no `halalgoes-api` service/image**), `API v1.2.25.json`, ORDERS_API_INTEGRATION_GUIDE.md (2,498 lines), README, .env.example.
- Timing: 51 minutes after the v1.2.25 release commit in hg-api (15:08), same afternoon. It is a deployment-support snapshot frozen at v1.2.25 — it predates even v1.2.26 (Oct 11) and reflects nothing of the subsequent four months of private backend evolution (no auth service, no Temporal service, no API container in the compose file). API deployment itself (the `halalgoes-api` Docker image RELEASE.md describes) is orchestrated elsewhere, privately.

---

## 4. Merged cross-repo timeline (annotated)

```
2025-03-10  halal-goes: Turborepo scaffold (Aaqeb11)
2025-03-21  halal-goes: apps/users init (Expo)
2025-05/06  halal-goes: Expo build fixes, then 2-month lull
2025-08-14  halal-goes: PR #58 hal-102 — apps/web + apps/docs land (boilerplate; never developed)
2025-08-18  halal-goes: apps/restaurant (mobile) first commits
2025-08-20  halal-goes: rider Supabase auth (cdeed78)
2025-09-12  halal-goes: packages/auth created (Supabase wrapper)
2025-09-16  halal-goes: apps/admin-web created
2025-09-18  (hg-api pre-history: first Prisma migration date 20250918024459_init)
2025-09-25  halal-goes: apps/restaurant-web created "complete ... with authentication"
2025-09-27  halal-goes: users app integrates user/address/feed APIs
2025-09-30  halal-goes: rider calls http://api.halalgoes.com/riders — PROD BACKEND ALREADY LIVE
2025-10-05  hg-api born: squash commit 86c52a7 + releases 1.2.23/24/23/25 within 38 min
2025-10-05  hg-docker born (single commit, 51 min later, carries API v1.2.25.json)
2025-10-07/09 halal-goes: abid "integrate backend" ×3, auth fix/fix/revert churn
2025-10-11  hg-api v1.2.26 (checkout worker fix) — LAST EVER hg-api COMMIT
2025-10-13/15 halal-goes: websocket order flows across users/rider/restaurant-web
2025-10-20/21 halal-goes: approval flows SIMULATED via extra Supabase (backend gap)
2025-11-03/05 halal-goes: raw IP 98.130.76.223 enters envs (users, admin, restaurant-web)
2025-11-13  halal-goes: restaurant-web websockets vs 98.130.76.223
2025-11-20  halal-goes: CI added AM (packages/auth excluded from build), deleted PM
2025-12 → 2026-01  halal-goes: framework bumps, admin/restaurant-web pages, Expo 53
2026-01-28  halal-goes: users Supabase→halalgoes /auth/otp (BREAKING, hal-171)
2026-01-29  halal-goes: rider same (hal-173)
2026-02-02  halal-goes: admin/restaurant-web register/login/onboarding + /admin/{refunds,disputes,settlements} clients vs https://api.halalgoes.com (hal-172); Shaik Noorullah's only 4 frontend commits (Stripe onboarding fixes)
2026-02-04  halal-goes: rider onboarding docs upload (hal-176); HEAD = merge PR #135
```

---

## 5. Open questions the code/history cannot answer

- Where the post-2025-10-11 backend source lives (private repo, likely a continuation of the pre-squash hg-api ancestor); whether better-auth was ultimately the auth implementation (frontends' OTP/refresh-token shape is consistent with a custom OTP flow, not obviously better-auth's session model).
- What produced collection v1.0.10 and the 1.0.10→1.2.23 delta (both predate available history).
- Why hg-api's history was squashed/truncated on 2025-10-05 (publication for the frontend agency is the most plausible reading: hg-docker's integration guide appeared the same hour).
- Why packages/auth was excluded from CI (commit message says only "not requrired").
- Actual Linear ticket contents (hal-*) — only branch names are visible.
