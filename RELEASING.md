---
covers:
  - deploy/**
reviewed: 2026-09-28
---

# Releasing HalalGoes

The single place the go-live configuration lives. Full engineering status:
[`docs/planning/v1-status.md`](docs/planning/v1-status.md).

## What `v1.0.0-rc1` is

A **release candidate**, gate-verified green on a **clean database** (the way a real deploy
checks it): `go build`/`vet` clean, contract **conformance 152/152** (idempotent, twice), full
`go test ./...` green, root `pnpm check` green, and the compose stack boots from an empty volume
and is healthy. It is **not GA** — launch is gated by the client-side flips in §3, most critically
A2P sign-in.

## 1. Push the release

The code is committed locally on `main` (and `integration`) and tagged. Push from a shell where
your GitHub SSH key is loaded:

```bash
git push origin main
git push origin integration
git push origin v1.0.0-rc1
```

## 2. Environment variables, by surface

Copy each `*.env.example` to its live counterpart (all gitignored) and fill in. `.env.example`
files are committed and carry **no real secrets**.

| Surface | Copy to | Key vars |
|---|---|---|
| Backend / compose | `deploy/.env.example` → `deploy/.env` | DB/Redis/MinIO + auth keys + the **§3 go-live flips** |
| Admin (`@hg/admin`, Vite) | `apps/admin/.env.example` → `apps/admin/.env.local` | `VITE_API_BASE_URL`, `VITE_MAPBOX_TOKEN` |
| Restaurant (`@hg/restaurant`, Vite) | `apps/restaurant/.env.example` → `apps/restaurant/.env.local` | `VITE_API_BASE_URL` |
| Customer (`@hg/customer`, Expo) | `apps/customer/.env.example` → `apps/customer/.env` | `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_MAPBOX_TOKEN` |
| Rider (`@hg/rider`, Expo) | `apps/rider/.env.example` → `apps/rider/.env` | `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_MAPBOX_TOKEN` |

**Mapbox tokens** (create at https://account.mapbox.com/access-tokens):
- Make **public tokens** (`pk.…`) with **public scopes only** (STYLES:TILES, STYLES:READ,
  FONTS:READ, DATASETS:READ, VISION:READ) — **no secret scopes**.
- `hg-web-admin` → `VITE_MAPBOX_TOKEN`; **URL-restrict** it to your admin origin(s) (dev:
  `http://localhost:5173,http://localhost:4173`; prod: `https://admin.<your-domain>`).
- `hg-mobile-apps` → `EXPO_PUBLIC_MAPBOX_TOKEN` (customer + rider); native SDKs **cannot** be
  URL-restricted — keep it minimal, rotate if abused. (Mobile maps need an Expo dev build.)
- A **secret token** (`sk.…`) is **not needed** — the backend never calls Mapbox. Only create one
  for programmatic Studio style/tileset publishing, keep it in a password manager / CI secret,
  and **never** put it in a `VITE_*`/`EXPO_PUBLIC_*` var (those ship to the client).

## 3. Go-live flips (turn each client-gated item live)

Each is a config change, not an eng sprint — the seams are built. Do them in this order.

1. **SMS / phone-OTP sign-in (O-03) — start FIRST, longest lead.** Register A2P 10DLC, then in
   `deploy/.env`: `HG_SMS_PROVIDER=twilio` + `HG_TWILIO_ACCOUNT_SID` / `HG_TWILIO_AUTH_TOKEN` /
   `HG_TWILIO_FROM_NUMBER` / `HG_TWILIO_MESSAGING_SERVICE_SID`. (Config **refuses to boot** if
   `provider=twilio` and any are missing. Default `log` keeps OTP working in dev.) *Nobody signs
   in until this lands.*
2. **Stripe live + Connect payouts.** `HG_STRIPE_SECRET_KEY` + `HG_STRIPE_WEBHOOK_SECRET`
   (+ `HG_STRIPE_CONNECT_RETURN_URL` / `HG_STRIPE_CONNECT_REFRESH_URL` for rider onboarding).
   Empty keys = fake local gateway.
3. **HST / tax (O-01).** `HG_TAX_HST_REGISTRATION_NUMBER` + `HG_TAX_PLATFORM_LEGAL_NAME` — rendered
   on receipts only when set. (Tax is already computed.)
4. **Mapbox token(s)** — §2.
5. **Product decisions** (defaults coded): O-05 launch province (default Ontario), O-06
   self-declared halal (default hide), O-04 refund liability.
6. **Production hosting** — a box/cluster + domain/DNS + TLS for Traefik.

## 4. Deploy the stack (on your host)

```bash
cp deploy/.env.example deploy/.env      # edit secrets + §3 flips; HG_ENV=production
cd services/hg
make up            # Traefik + 2× API + Postgres/PostGIS + Redis + MinIO
make migrate       # apply migrations 0→N
curl -fsS http://<host>:${HG_HTTP_PORT:-8080}/health/ready   # expect 200
```

Outside `local`, the binary refuses to boot if any dependency still points at `localhost`, or if
`HG_SMS_PROVIDER=twilio` with incomplete creds — misconfig fails loudly, never silently.

## 5. Verify the gate (any time)

```bash
cd services/hg
make down-hard && make up && make migrate                    # clean DB
set -a; . ../../deploy/.env; set +a
export HG_TEST_POSTGRES_DSN="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:5432/$POSTGRES_DB?sslmode=disable"
go test -count=1 ./... && go test -count=1 -run Conformance ./internal/conformance/...
```

Green on a **clean** DB is the real bar — a green that only holds on a reused DB is a false green
(that exact bug was fixed in `c9ac97d`).
