# Umami on Vercel + Neon — the path for today

The VPS is the destination, not the starting point. This runs Umami on Vercel
against the Neon branch already linked in this repo, so analytics exist from the
first day the site is public. `README.md` is the Contabo move for later, and
§5 here is how you get from one to the other without losing history.

Neon project: `jolly-paper-41441437` · `umami-hg-analytics-dev-india` ·
branch `production` · region `aws-ap-southeast-1`.

---

## 1. The one thing that will break the build

Umami runs its Prisma migrations **during the Vercel build**. Its `build` script
includes `check:db`, and `scripts/check-db.js` shells out to `prisma migrate
deploy` unless `SKIP_DB_MIGRATION` is set. Neon gives you two connection strings
and they are not interchangeable:

| Neon gives you | Host contains | Use it for |
|---|---|---|
| `DATABASE_URL` | `...-pooler...` | the app's runtime queries |
| `DATABASE_URL_UNPOOLED` | no `-pooler` | **migrations** |

The pooled endpoint is PgBouncer in transaction mode. Prisma migrations need
session-level features — advisory locks, prepared statements — which transaction
pooling does not provide, so running them through the pooler fails in a way that
reads like a network error.

The trap is the fallback. `check-db.js` does:

```js
const directUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
execSync('prisma migrate deploy', { env: { ...process.env, DATABASE_URL: directUrl } });
```

Leave `DIRECT_DATABASE_URL` unset and nothing complains about a missing
variable — it quietly migrates through the pooler. It is a **build-time**
variable, so setting it later without a redeploy changes nothing.

So: `DATABASE_URL` = pooled, `DIRECT_DATABASE_URL` = unpooled. Get both with

```bash
neon connection-string --pooled          # DATABASE_URL
neon connection-string --pooled false    # DIRECT_DATABASE_URL
```

or read them out of `.env.local`, which `neon link` already wrote (and which is
gitignored — do not commit it).

---

## 2. Create the Vercel project

Umami is its own Next.js app, so this is a **second Vercel project**, importing
`umami-software/umami` — not this repo. Fork it if you want to pin a version and
control when it updates; import it directly if you would rather track upstream.

Root Directory: the repo root. Framework: Next.js, auto-detected. Node 22.

### Environment variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | the **pooled** string |
| `DIRECT_DATABASE_URL` | the **unpooled** string |
| `DATABASE_TYPE` | `postgresql` |
| `APP_SECRET` | `openssl rand -hex 32` |
| `TWO_FACTOR_ENCRYPTION_KEY` | `openssl rand -hex 32` (a different one) |
| `TRACKER_SCRIPT_NAME` | `hg` |
| `COLLECT_API_ENDPOINT` | `/api/hg-collect` |
| `DISABLE_TELEMETRY` | `1` |

Generate the two secrets locally and paste them; do not reuse one for both.
They are what sign session tokens and encrypt 2FA secrets respectively.

**Easier alternative for the two database URLs:** install the Neon integration
from the Vercel marketplace and connect it to this project. It writes
`DATABASE_URL` and `DATABASE_URL_UNPOOLED` into the Vercel project itself and
rotates them with the branch, so the password never passes through a clipboard.
You still add `DIRECT_DATABASE_URL` by hand, pointing at the unpooled value.

### Domain

`analytics.halalgoes.com` → this Vercel project. A subdomain of the site's own
apex is the point: it makes the tracker first-party, which is most of why we are
self-hosting rather than using Umami Cloud.

---

## 3. First login

Umami ships a known default — **`admin` / `umami`**. Your instance is on the
public internet the moment the domain resolves. Change it immediately and turn
on two-factor.

Then **Settings → Websites → Add website** — name `halalgoes.com`, domain
`halalgoes.com` — and copy the **Website ID**.

---

## 4. Point the marketing site at it

In the **marketing** Vercel project, Production environment only:

```
NEXT_PUBLIC_UMAMI_SRC        = https://analytics.halalgoes.com/hg.js
NEXT_PUBLIC_UMAMI_WEBSITE_ID = <the UUID from step 3>
```

`hg.js` because `TRACKER_SCRIPT_NAME=hg`. Change one, change both.

**These are inlined at build time — redeploy the marketing site after setting
them.** Then verify both sides of the consent gate, per `apps/marketing/DEPLOY.md` §5:
no request to `analytics.halalgoes.com` before accepting, a hit in Umami after.

---

## 5. Moving to Contabo later

Nothing here is a dead end. The VPS stack in `README.md` runs its own Postgres in
`docker-compose.yml`; you have two ways across:

**Keep Neon, move only the app.** Delete the `umami-db` service from
`docker-compose.yml` and point `DATABASE_URL` at Neon. Fewest moving parts, and
history comes with you untouched. The compute moves to Europe while the data
stays in Singapore, which is the wrong shape long-term but fine as a step.

**Move both.** Dump from Neon, restore into the container:

```bash
pg_dump "$NEON_DIRECT_URL" --no-owner --no-acl -Fc -f umami.dump
docker compose exec -T umami-db pg_restore -U umami -d umami --no-owner < umami.dump
```

Then swap the DNS record for `analytics.halalgoes.com` from Vercel to the VPS.
The tracker URL does not change, so the marketing site needs no redeploy — which
is the reason it points at a hostname you control rather than at a vendor's.

---

## Two things to know now rather than later

**The database is in Singapore.** Vercel's functions will not be, and the traffic
is Ontario. Every pageview write crosses the Pacific twice. It is a fire-and-
forget beacon so nobody waits on it, but it will look slow in the network panel
and the cost is real when volume arrives. When you create the *production* Neon
project, pick a region near Toronto — `aws-us-east-1` or `aws-us-east-2`. This
one is named `-dev-` for a reason; do not let it quietly become production.

**Vercel Hobby is non-commercial** under their terms, and that applies to this
second project as much as to the site.
