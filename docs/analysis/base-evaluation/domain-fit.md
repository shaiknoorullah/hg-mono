# HalalGoes — Domain Fit Evaluation of `ts-monorepo-template`

**Repo:** `/workspace/shaiknoorullah/ts-monorepo-template`
**Date:** 2026-08-09
**Scope of this report:** which HalalGoes needs the template *already serves*, and how. (No repo files modified.)

## TL;DR

The template is a **polyglot multi-tenant SaaS scaffold** with outstanding *tooling, config, infra-as-code, and docs*, but a **very thin application layer**. It gives HalalGoes: three Expo client shells (web/customer/admin), a Tamagui + NativeWind design system, a forms/zod kit, a bare Fastify gateway, a BullMQ worker, a drizzle/pg client, a Payload CMS, and consent/tracking/SEO packages. It ships **config schemas and docker-compose stacks** for Temporal, Kafka, Keycloak, Meilisearch, MinIO/R2 — but **almost none of that is wired into application code**.

Every capability that makes HalalGoes a *food-delivery* app — realtime tracking, PostGIS geo dispatch, Stripe/Connect payments, the checkout saga, object storage for KYC, push notifications, ratings, phone-OTP auth, rider/restaurant onboarding — is **absent or config-only** and would be built from scratch. The template's biggest active mismatch is that it is **opinionatedly multi-tenant SaaS**, which HalalGoes explicitly does *not* need; that machinery is overhead to strip or ignore.

---

## 1. Frontend surfaces

### What exists
| App | Stack | State |
|---|---|---|
| `apps/web-app` | Expo + expo-router + react-native-web, deploys to Cloudflare Pages | Tenant-aware shell: `_layout.tsx` wires `TenantThemeProvider`, `getTenantSlug()`, a Home screen and a **stub** `sign-in.tsx` (email/password, `// TODO: wire @pkg/auth-client.signIn`). |
| `apps/mobile-customer` | Expo | Bare stub — single Home screen ("Customer-facing mobile app."). No auth, no navigation beyond index. |
| `apps/mobile-admin` | Expo | Bare stub — single Home screen ("Admin-facing mobile app for tenant operators."). |
| `apps/marketing` | Astro (+ Cloudflare) | Marketing site scaffold. |
| `apps/docs-public` | Astro Starlight | Public docs generator. |
| `apps/cms` | Payload 3 on Next.js | Content admin (see §4). |

Shared UI/client packages:
- **`packages/ui`** — Tamagui-based: `TenantThemeProvider`, `toTamaguiTheme`, `useTenantTheme`, `tokens`, light/dark themes, `useColorScheme`, `useToast`, icons.
- **`packages/ui-nativewind`** — a *parallel* NativeWind primitive set (`Button`, `Card`, `Input`, `Text`, `View`) kept API-symmetric with `@pkg/ui` so an app can swap engines by changing imports. (ADR 0012 documents the Tamagui-vs-NativeWind choice.)
- **`packages/forms`** — `createForm` + `commonSchemas` (email, url, `nonEmpty`, **`phoneE164`** regex).
- **`packages/seo`** — OpenGraph image generation + JSON-LD helpers.
- **`packages/api-client`** — typed fetch wrapper that auto-injects `Authorization: Bearer` and **`x-tenant`** headers.

### Fit to HalalGoes' four surfaces
- **Customer app** → `mobile-customer` (+ `web-app` for web ordering). Shells only; all commerce UI is greenfield.
- **Admin dashboard** → `mobile-admin` (framed as "tenant operators"). Shell only.
- **Rider app** → **MISSING.**
- **Restaurant portal** → **MISSING.**

Two of the four surfaces don't exist. Adding them is *mechanical* — copy the `mobile-customer`/`web-app` Expo pattern (`app.json`, `eas.json`, `babel.config.js`, expo-router `app/` dir, wire `@pkg/ui`/`api-client`/`auth-client`) into `apps/rider` and `apps/restaurant` (a portal is likely better as an Expo-web or Next surface). It's net-new work but the scaffolding pattern, design system, and deploy config (EAS, wrangler) are reusable. The current apps are essentially empty (Home screens), so "maps to" means "provides a starting shell," not "provides the surface."

---

## 2. Auth

**Package:** `packages/auth-client` — "Ory Kratos by default; Keycloak provider also supported."

What it actually does (`client.ts`):
- `signIn({ email, password })` — posts to Kratos `self-service/login?flow=api` (a simplified path; the code comment admits real flows need an initiate-then-submit dance).
- `getSession()` — calls Kratos `sessions/whoami`, maps identity traits to a `User` (id, email, name, roles).
- `signOut()`.
- `Session.token` is returned as **empty string** — the model is **cookie/session-based**, not a bearer JWT minted client-side.

Assessment against HalalGoes needs:
- **Phone-OTP: ABSENT.** No OTP/passwordless flow anywhere in code. The only phone artifact is the `phoneE164` regex in `packages/forms`. (Kratos *can* do OTP/passwordless, but it is neither configured nor exposed by the client. Documentation mentions "passwordless" only in research/spec files.) This is net-new: Kratos config + new client methods (`startOtp`, `verifyOtp`), or a Twilio/SMS provider.
- **JWT: PARTIAL / config-only.** `config/schema.ts` `AuthSchema` is OIDC-shaped (`issuer`, `audience`, `jwksUri`, `clientId`/`clientSecret`) and `prod.yaml` wires `OIDC_ISSUER`/`OIDC_JWKS_URI` — i.e., the *intent* is JWT/JWKS validation at the gateway. But **the api-gateway has no auth middleware** (it's just `/health` + `/ready`), and `auth-client` doesn't produce a JWT. So JWT is a documented plan, not a working path.
- **Rider/restaurant onboarding + KYC: ABSENT.** No onboarding flows, no verification state machine, no KYC document capture/review. The `User` model has a free-form `roles: string[]` you could overload for `customer|rider|restaurant|admin`, and the CMS `Users` collection has a `role` enum (`admin|editor|viewer`) + an argon2id migration hook — but neither models an applicant → KYC-pending → approved lifecycle.
- The `web-app` `sign-in.tsx` is a **non-wired stub**; `mobile-customer`/`mobile-admin` have no sign-in at all.

There is no dedicated auth ADR; ADR 0009 covers Expo, and auth appears in `docs/superpowers/specs/2026-06-03-platform-foundation-design.md` and research files. Bottom line: **email/password against Kratos is the only real auth; phone-OTP, JWT enforcement, and onboarding/KYC are all to-build.**

---

## 3. Multi-tenancy

The template is **built around multi-tenant SaaS** as a first-class assumption:
- `packages/tenancy-client` — `resolveTenantFromHostname('acme.app.example.com', ...) → 'acme'`, slug validation, reserved-subdomain handling.
- `config/tenants/` + `TenancySchema` (`strategy: schema|row|database|none`, `defaultTenant`, `isolation: strict|permissive`); `_example-tenant.yaml` shows per-tenant DB schema, feature flags, branded auth realm.
- `apps/cms` uses `@payloadcms/plugin-multi-tenant` with a `Tenants` collection (name/slug/plan + per-tenant **theme** group).
- `packages/ui` `TenantThemeProvider` fetches per-tenant theme; `api-client` injects `x-tenant`; an edge "cf-tenant-router" Worker sets `x-tenant` on `*.app.example.com`.

**Fit for HalalGoes (single marketplace, multi-tenancy NOT needed):** this is **net overhead**, not a help. The subdomain-per-tenant model, tenant config layering, and multi-tenant CMS plugin add conceptual and code surface HalalGoes doesn't want. Mitigation is cheap (set `tenancy.strategy: none`, keep `defaultTenant`, ignore/remove the resolver and tenant router), but it's cleanup work and a persistent source of "why is this here?" friction. The one *reusable* piece is the **per-tenant theming machinery**, which could be repurposed for **per-restaurant branding** in the restaurant portal / storefront if desired — but that's opportunistic, not designed for it.

---

## 4. CMS / content / consent / tracking

- **`apps/cms` (Payload 3 + Postgres):** collections `Pages`, `Posts`, `Media`, `Tenants`, `Users`. `Users` uses Payload auth hardened with **argon2id** + a Kratos-migration tracker field. **`Media`** supports uploads incl. `application/pdf` and image resizing, but is **public-read** (`read: () => true`) — *not* suitable as-is for KYC docs.
- **Object storage plumbing (important, see §5):** `payload.config.ts` wires `@payloadcms/plugin-cloud-storage` to R2/S3 env vars (`R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, …) — **but the S3 adapter is a deliberate build-time STUB** (`name: 's3-stub'`, `handleUpload` no-op, `staticHandler` returns HTTP 501). So real object storage is *configured but not functional*.
- **`packages/cms-client`** — Payload REST client + Astro content-layer loaders (payload, decap).
- **`packages/consent`** — GDPR cookie banner (vanilla-cookieconsent v3) + Zustand consent store.
- **`packages/tracking`** — `configure/identify/page/track` analytics facade.

**Fit for HalalGoes:** genuinely useful for the **marketing site and any editorial/menu-content pages**, and the consent/tracking packages are ready for the customer web app. But for the *core delivery product* (orders, menus-as-data, dispatch), Payload is tangential — restaurant menus/pricing/inventory belong in the transactional Postgres domain, not the CMS. Net: helpful at the edges, **overkill/irrelevant for the operational core**. The Media/R2 wiring is the closest thing to KYC object storage but is both public-read and stubbed.

---

## 5. Realtime, geo, payments, storage, notifications, saga/workflow, eventing

I searched the whole repo (code, config, docker, docs) and cross-checked actual runtime dependencies in every `package.json`. The only relevant runtime deps present are **`bullmq`, `ioredis`, `drizzle-orm`, `pg`**. No `@temporalio/*`, `kafkajs`, `stripe`, `@aws-sdk/*`, `socket.io`, `ws`, `expo-notifications`, `expo-location`, or `firebase` anywhere.

| Capability | Status | Evidence |
|---|---|---|
| **Realtime / WebSocket** | **ABSENT (code)** | No `ws`/`socket.io` deps or server code. "websocket" appears only in docs (`docs-public`, research, edge-obs specs). Gateway is HTTP-only Fastify. |
| **Geo / PostGIS** | **ABSENT** | No PostGIS, no geo/gis libs, no `expo-location`, no lat/lng in schema. `db-client` is a plain drizzle/pg pool wrapper with no spatial support. |
| **Payments / Stripe / Connect** | **ABSENT (code)** | Stripe appears *only* as an example secret ref in `config/schema.ts` and in docs/plans. A generic `webhook-receiver` Worker exists under `infra/cloudflare` but has no payment logic. |
| **Object storage (S3/MinIO/R2)** | **PARTIAL / stubbed** | Config `SecretRef` examples + Payload cloud-storage plugin wired to R2 envs, **but the S3 adapter is a build-time no-op stub (501)**. MinIO appears in `docker/cms.compose.yml` for local dev. No general-purpose blob client package. |
| **Temporal / saga** | **CONFIG-ONLY** | `TemporalSchema` in config, `temporal` block in base/staging/prod yaml, `docker` stack, and an *excellent* decision spec (`docs/specs/governance-saas/temporal-when-and-when-not.md`). **No `@temporalio` dependency, no workflow/activity/worker code.** The `apps/worker` is a **BullMQ** (Redis) job stub, not Temporal. |
| **Kafka / eventing** | **CONFIG-ONLY** | `KafkaSchema` (SASL, schema registry) + `docker/kafka.compose.yml`, `debezium`, `apicurio`, `kroxylicious` compose files + data-eventing/event-journal specs. **No `kafkajs` dependency or producer/consumer code.** |
| **Push / notifications** | **ABSENT** | Only SMTP (`MailerSchema`) config exists. No `expo-notifications`, no FCM/APNs, no push package. |
| **Ratings** | **ABSENT** | No model, contract, or code. |

**Backend reality check:** `apps/api-gateway` is a bare Fastify app (helmet, cors, `/health`, `/ready`) — no routes, no auth, no domain. `apps/worker` is a bare BullMQ consumer that parses `{type, payload}` and acks. `packages/db-client` is a lazy pg-pool wrapper with no schema/migrations. `packages/contracts` defines only `user.v1` and `health.v1` protobufs (gen'd for go/py/rs/ts). The food-delivery domain model does not exist.

---

## Capability-fit matrix

| HalalGoes need | Provided / Partial / Absent | Notes |
|---|---|---|
| Customer app surface | **Partial** | `mobile-customer` + `web-app` Expo shells; empty Home screens, no commerce UI. |
| Admin dashboard surface | **Partial** | `mobile-admin` shell ("tenant operators"), empty. |
| Rider app surface | **Absent** | Not present; scaffold a new Expo app from existing pattern. |
| Restaurant portal surface | **Absent** | Not present; scaffold new (Expo-web or Next). |
| Design system / UI kit | **Provided** | `@pkg/ui` (Tamagui) + `@pkg/ui-nativewind`, tokens, theming, toasts, icons. |
| Forms + validation | **Provided** | `@pkg/forms` `createForm` + zod schemas incl. `phoneE164`. |
| Typed API client | **Provided** | `@pkg/api-client` with auth + tenant header injection. |
| Email/password auth | **Provided (thin)** | `@pkg/auth-client` → Ory Kratos (simplified); web sign-in is a stub. |
| Phone-OTP auth | **Absent** | No OTP flow; only an E.164 regex. Kratos/Twilio work to build. |
| JWT enforcement | **Partial (config-only)** | OIDC/JWKS config schema exists; no gateway middleware; client returns empty token. |
| Rider/restaurant onboarding + KYC | **Absent** | No onboarding lifecycle, no KYC capture/review; roles are free-form strings. |
| Object storage for KYC docs | **Partial (stubbed)** | Payload R2/S3 plugin wired but adapter is a no-op stub; Media is public-read. |
| Realtime order tracking (WebSocket) | **Absent** | No ws/socket.io; HTTP-only gateway. |
| Geo dispatch (PostGIS) | **Absent** | No PostGIS/geo libs, no spatial schema, no location capture. |
| Checkout saga (Temporal) | **Absent in code (config + great docs)** | Config + compose + decision spec, but no Temporal SDK/workflows; worker is BullMQ. |
| Payments / Stripe Connect | **Absent in code** | Stripe only in example config + docs; generic webhook Worker only. |
| Push / notifications | **Absent** | SMTP mailer config only; no push. |
| Ratings | **Absent** | Nothing. |
| Eventing (Kafka/CDC) | **Config-only** | Schema + compose (Kafka/Debezium/Apicurio); no client code. |
| Background jobs | **Provided** | `apps/worker` BullMQ + Redis (reusable for async tasks, not sagas). |
| Postgres data access | **Provided (thin)** | `@pkg/db-client` drizzle/pg pool; no domain schema/migrations/PostGIS. |
| Multi-tenancy | **Provided — but NOT wanted** | Full multi-tenant machinery = overhead for a single marketplace. |
| CMS / marketing / consent / tracking / SEO | **Provided** | Payload CMS, consent banner, analytics facade, OG/JSON-LD — useful at the edges, tangential to core. |
| Config / secrets / infra-as-code | **Provided (strong)** | Zod-validated layered config, SecretRefs, docker-compose stacks, Crossplane profiles, Taskfile, Nx. |

---

## Biggest domain gaps HalalGoes would face on this base

1. **The entire food-delivery domain is greenfield.** Orders, menus, carts, dispatch, delivery lifecycle, ratings — no models, contracts, routes, or UI. The gateway and worker are empty scaffolds.
2. **Realtime tracking has zero foundation.** No WebSocket layer at all; needs to be introduced from scratch (ws/socket.io or a hosted realtime service) plus client wiring in rider/customer apps.
3. **Geo/PostGIS is entirely missing.** Rider search / dispatch needs PostGIS extension, spatial schema, and `expo-location` capture — none present; `db-client` has no spatial story.
4. **The checkout saga is documentation, not code.** Temporal is configured and *well-reasoned about*, but there's no SDK, worker, or workflow; the only queue primitive is BullMQ (not durable-execution). Building the saga is full net-new work (the docs are a genuine head start on *how*).
5. **Payments are unbuilt.** No Stripe SDK or Connect onboarding; "mocked-then-real" means implementing both the mock and the real integration.
6. **KYC object storage is stubbed and public-read.** The R2/S3 plugin is a build-time no-op and Media is world-readable — unsafe for KYC. Needs a real, access-controlled storage adapter.
7. **Phone-OTP + onboarding/KYC lifecycle absent.** Auth is email/password-to-Kratos only; multi-role onboarding, verification states, and OTP are all to-build.
8. **Push notifications absent** (only SMTP).
9. **Two of four surfaces (rider, restaurant) don't exist** and must be scaffolded.
10. **Multi-tenancy is a subtractive tax.** The base assumes tenant-per-subdomain SaaS; HalalGoes must neutralize/remove tenancy-client, tenant config, `x-tenant` plumbing, the edge tenant router, and the CMS multi-tenant plugin — ongoing friction rather than a feature.

**Net:** the template is an excellent *engineering platform* (monorepo tooling, polyglot contracts, config/secrets, CI, infra-as-code, deploy targets, design system) and a good place to *host* HalalGoes, but it provides essentially **none of the delivery-domain capabilities** — and its strongest built-in opinion (multi-tenant SaaS) actively works against a single-marketplace product.
