# Self-hosting Umami on the Contabo VPS

> **This is the LATER path.** Today Umami runs on Vercel against Neon — see
> **[VERCEL.md](./VERCEL.md)**, which also covers getting from there to here
> without losing history. Nothing below is needed until the VPS exists.

Everything here is additive: a new directory, its own compose project, its own
database and volume. It edits nothing in `deploy/docker-compose.yml`.

Work top to bottom. §3 is the one that is easy to skip and then spend an evening
debugging.

---

## 1. The box

Contabo ships a bare OS with no cloud firewall in front of it, so the host
firewall is the only firewall. Docker publishes ports by punching straight
through `ufw`'s `INPUT` chain into `DOCKER-USER`, which means "ufw says denied"
and "the port is open" are both true at once. Only publish what you mean to.

```bash
# as root, on a fresh Debian/Ubuntu Contabo VPS
apt update && apt install -y ca-certificates curl git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

ufw default deny incoming
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Then a DNS **A record** for `analytics.halalgoes.com` → the VPS IPv4. Add the
**AAAA** record too if you gave Traefik IPv6, and not otherwise: an AAAA record
pointing at an address nothing listens on makes the site intermittently
unreachable for IPv6 clients, which is the worst kind of broken.

Confirm it resolves before going near certificates. Let's Encrypt will rate-limit
you for repeatedly failing the challenge, and the limit is measured in hours.

```bash
dig +short analytics.halalgoes.com
```

---

## 2. Secrets

```bash
cd deploy/umami
cp .env.example .env

printf 'UMAMI_APP_SECRET=%s\n'        "$(openssl rand -hex 32)"    >> .env
printf 'UMAMI_TWO_FACTOR_KEY=%s\n'    "$(openssl rand -hex 32)"    >> .env
printf 'UMAMI_POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)"    >> .env
```

(Delete the empty originals so the appended values are the ones that take.
`hex` rather than `base64` for the password on purpose: `@`, `:` and `#` all
terminate a `DATABASE_URL` early and the error you get is a connection failure
that looks like a network problem.)

---

## 3. Give Traefik HTTPS — the step that is easy to skip

> **On the production box this is done.** [`deploy/docker-compose.prod.yml`](../docker-compose.prod.yml)
> adds the `websecure` entrypoint and a `letsencrypt` resolver (TLS-ALPN on 443,
> so the HTTP-01 lines below are not needed) and turns the dashboard off; see
> [deploy/README.md](../README.md#production). The rest of this section is for a
> box running the base file alone.

**The product stack has no TLS today.** `deploy/docker-compose.yml` declares
`--entrypoints.web.address=:80` and the dashboard on `:8080`, and nothing else.
There is no `websecure` entrypoint and no ACME resolver, so `docker-compose.tls.yml`
would reference an entrypoint that does not exist and the router would silently
never match.

This is a prerequisite for going live at all, not something Umami introduced.
Add to the `traefik` service in `deploy/docker-compose.yml`:

```yaml
    command:
      # ... keep everything already there, then:
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL:?set ACME_EMAIL}
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.letsencrypt.acme.httpchallenge=true
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - letsencrypt:/letsencrypt
```

plus a `letsencrypt:` entry under the top-level `volumes:`.

Two things that will bite:

- **`${HG_HTTP_PORT:-8080}:80` has to become `80:80`.** The HTTP-01 challenge is
  served on port 80 of the public IP. On 8080 it can never succeed.
- **Turn off the insecure dashboard before this box is public.** The stack runs
  `--api.insecure=true` and publishes `:8081`. That is fine on a laptop and is
  an unauthenticated view of your whole routing table on a VPS.

Take the staging CA for the first run — the production rate limit is five
failures per account per hostname per hour, and you will not enjoy waiting it
out:

```yaml
      - --certificatesresolvers.letsencrypt.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory
```

Remove that line and delete `acme.json` once a staging cert is issued.

---

## 4. Bring it up

```bash
# the product stack first — it owns the network this one joins: hg-net with
# the base file alone, hg-analytics-proxy on the production box
# (docker-compose.tls.yml keeps Umami and its database off every HalalGoes network)
cd deploy && docker compose --env-file .env up -d

cd umami
docker compose --env-file .env \
  -f docker-compose.yml -f docker-compose.tls.yml up -d

docker compose logs -f umami     # first boot runs the migrations; give it a minute
```

Healthy looks like `/api/heartbeat` answering:

```bash
docker compose exec umami curl -fsS http://localhost:3000/api/heartbeat
curl -I https://analytics.halalgoes.com
```

---

## 5. Change the password before anything else

Umami ships a known default — **`admin` / `umami`** — and your instance is now
on the public internet. Log in at `https://analytics.halalgoes.com`, change it
immediately, and turn on two-factor while you are there (that is what
`UMAMI_TWO_FACTOR_KEY` was for).

Then **Settings → Websites → Add website**:

- Name: `halalgoes.com`
- Domain: `halalgoes.com`

Save, then open it and copy the **Website ID** — a UUID. That is the value the
site needs.

---

## 6. Point the site at it

Two variables, in Vercel, for the **Production** environment:

```
NEXT_PUBLIC_UMAMI_SRC        = https://analytics.halalgoes.com/hg.js
NEXT_PUBLIC_UMAMI_WEBSITE_ID = <the UUID from step 5>
```

`hg.js` because `UMAMI_TRACKER_SCRIPT_NAME=hg`. If you change one, change both.

**These are read at build time**, not at runtime — `NEXT_PUBLIC_*` is inlined
into the output. Setting them is not enough; you have to redeploy. Until both
are set, `Analytics.tsx` renders nothing at all rather than a tag pointing at
`undefined`.

---

## 7. Verify it properly

The tag ships inert and Klaro activates it on consent, so "no data" is the
correct behaviour right up until someone accepts. Test both sides:

1. Open the site in a private window. Before touching the banner, Network should
   show **no request** to `analytics.halalgoes.com`. In the Elements panel the
   tag reads `type="text/plain"`.
2. Click **Accept all**. The same tag flips to `type="text/javascript"`, `hg.js`
   loads, and a POST lands on `/api/hg-collect`.
3. The visit appears in Umami within a few seconds — it is not batched.
4. Click **Decline** in a fresh private window. Nothing is requested, ever.

If step 2 does nothing, it is almost always one of: the env vars were set but
not redeployed (§6), or the website ID belongs to a different website record.

---

## Operating it

**Backups.** `umami-pgdata` is the only state. Losing it loses analytics history
and nothing else — which is exactly why it is not in the product's database.

```bash
docker compose exec -T umami-db pg_dump -U umami umami | gzip > "umami-$(date +%F).sql.gz"
```

**Upgrades.** Pin `UMAMI_IMAGE_TAG`, then move it deliberately:

```bash
docker compose --env-file .env pull && docker compose --env-file .env up -d
```

Migrations run on boot, so take the dump above first.

**Resources.** Umami plus Postgres idles around 512MB. The smallest Contabo VPS
is comfortable for a marketing site. Revisit when the customer and rider apps
start reporting, not before.

---

## Two things to know before you change settings

- **Session replays and heatmaps are off by default — leave them off for now.**
  Umami v3 can record them, and they capture behaviour on the page. The consent
  copy currently on the site says measurement "records no personal data", which
  is true of pageview analytics and stops being true of a session replay. Turn
  either on and the banner copy in `src/lib/consent.ts` has to change first, and
  the `version` there has to be bumped so everyone is re-asked.
- **Umami sets no cookies** (their FAQ says so plainly), so strictly it needs no
  consent notice at all under PIPEDA. It is behind consent anyway, on purpose: a
  platform whose whole argument is "we checked, we didn't assume" cannot opt
  people into measurement by default. That is a positioning decision, not a
  legal one — do not let anyone quietly "fix" it.
