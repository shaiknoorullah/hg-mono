---
covers: [deploy/docker-compose.prod.yml]
reviewed: 2026-10-04
---

# Deploy

[`docker-compose.yml`](docker-compose.yml) is the whole stack in the shape production runs in; run it locally with `docker compose --env-file .env up --build`. The overrides change only what differs:

| File | For |
|---|---|
| [`docker-compose.prod.yml`](docker-compose.prod.yml) | production, below |
| [`docker-compose.isolated.yml`](docker-compose.isolated.yml) | a second local stack beside the dev dependencies |
| [`umami/`](umami/README.md) | self-hosted analytics, its own compose project |

## Production

One Contabo Cloud VPS 6 (6 vCPU, 12 GB) in US-East, and at launch the only server: the warm standby ([#210](https://github.com/shaiknoorullah/hg-mono/issues/210)) comes next month ([the owner's decision of 4 Oct 2026](https://github.com/shaiknoorullah/hg-mono/issues/207#issuecomment-5976966570), [hosting plan, #207](https://github.com/shaiknoorullah/hg-mono/issues/207)). A permanent dev environment will run beside production on the same box ([#235](https://github.com/shaiknoorullah/hg-mono/issues/235), still being planned); this override leaves it memory and a seam, below, but does not build it. The override is [#208](https://github.com/shaiknoorullah/hg-mono/issues/208). What it changes:

- **Ports.** Only Traefik publishes, on 80 and 443 ([#200](https://github.com/shaiknoorullah/hg-mono/issues/200)). The Silo console is on the host's loopback: `ssh -L 9001:127.0.0.1:9001 prod`, then open `http://localhost:9001`.
- **TLS.** Port 80 only redirects to HTTPS. Certificates come from Let's Encrypt through the TLS-ALPN challenge on 443, and both public hosts send HSTS ([#51](https://github.com/shaiknoorullah/hg-mono/issues/51)). No dashboard; the access log keeps no headers.
- **Docker socket.** Traefik reads container labels through [Tecnativa's docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy), which answers only reads, on a network nothing else joins.
- **Files host.** `files.<domain>` reaches Silo only for an object in one of the five buckets, with GET, HEAD, PUT or OPTIONS, and never with a copy-source, streaming-upload or replication header. `/minio/`, bucket listings and everything else get 404. Signed upload and download links are signed for this host (`HG_MINIO_PRESIGN_BASE_URL`, set by the override).
- **Client addresses.** `hg-net` has a fixed subnet, 172.30.0.0/24, and the override sets `HG_TRUSTED_PROXY_CIDRS` to it, so the API reads the client's address from Traefik's `X-Forwarded-For` and believes no one else's.
- **Virus scanning.** ClamAV runs on this box until the standby takes it over: a 4 GiB limit, two scan threads, signature reloads one at a time, and nothing passed unscanned: an upload over 16 MiB is refused with an `INSTREAM size limit exceeded` error, which the scanning worker must treat as not clean, and content that unpacks past 100 MiB is reported as found. The unpacking limits are 100 MiB rather than 16 because a clean scanned PDF can decompress past 16 MiB and would otherwise be reported as infected. It is on `hg-scan`, a network it shares with the API alone, and is neither published nor routed. Nothing calls it yet: the API's scanning worker is [#218](https://github.com/shaiknoorullah/hg-mono/issues/218).
- **Images.** No `build:`. The API, migration and Postgres images come from GHCR by digest; the rest are pinned by digest in the files.
- **Limits.** Every container has a memory limit and no swap on top of it; logs rotate at 20 MB × 5.
- **Valkey** keeps nothing on disk and requires a password. Flushing it costs latency, never correctness ([platform spec, ground rules](../docs/spec/01-platform.md#0-ground-rules-that-bind-every-section)).
- Maps and address search come from Mapbox through the API, so the box serves no map files and runs no geocoder.

### Memory budget

Docker counts limits in MiB, so this table does too. The kernel reports about 11.7 GiB of the 12 GiB (the [hosting plan's](https://github.com/shaiknoorullah/hg-mono/issues/207) figure; check with `free -m` on the box). Every row is a ceiling, not a measurement: real use at launch is well under the limits.

| | MiB | Settings |
|---|---:|---|
| Kernel and firmware, not usable | 308 | |
| OS, dockerd, sshd, WireGuard, journald | 700 | held back |
| **In this override** | | |
| Traefik + socket proxy | 128 + 48 | `GOMEMLIMIT=96MiB`, 300 s read timeout on 443 for slow uploads |
| API × 2 | 2 × 320 | `GOMEMLIMIT=256MiB`, 1.5 CPUs, 8 database connections each |
| Postgres | 2,048 | `shared_buffers=512MB`, `effective_cache_size=1280MB`, `max_connections=60`, `shm_size` 256 MB |
| Valkey | 128 | `maxmemory 64mb`, `allkeys-lru` |
| Silo | 512 | `GOMEMLIMIT=400MiB`, 32 requests at once, slow scanner |
| ClamAV | 4,096 | `MaxThreads 2`, `ConcurrentDatabaseReload no`, 2 CPUs |
| *Subtotal* | *7,600* | |
| **Production, in later overrides** | | budgeted here, not started by this file |
| nginx for the static sites ([#213](https://github.com/shaiknoorullah/hg-mono/issues/213)) | 256 | |
| GlitchTip, Umami and their Postgres ([#208](https://github.com/shaiknoorullah/hg-mono/issues/208)) | 384 + 320 + 256 | |
| Metrics agents, exporters, Gatus, Fluent Bit ([#65](https://github.com/shaiknoorullah/hg-mono/issues/65)) | 160 + 48 | |
| Backup jobs ([#64](https://github.com/shaiknoorullah/hg-mono/issues/64)) | 256 | |
| Metrics and log stores, until the standby holds them ([#210](https://github.com/shaiknoorullah/hg-mono/issues/210)) | 384 | |
| *Subtotal* | *2,064* | |
| **Production total** | **9,664** | |
| A deploy: two more API replicas for about a minute | 640 | [docker-rollout](https://github.com/wowu/docker-rollout) runs old and new side by side |
| **Left for dev ([#235](https://github.com/shaiknoorullah/hg-mono/issues/235))** | **976** | |
| **The box** | **12,288** | |

The dev environment's limits must fit its 976 MiB. One shape that does, for #235 to decide: one API replica (320), Postgres (384), Valkey (32) and Silo (192), 928 in all, sharing production's Traefik and ClamAV. When the box runs short, dev stops first ([runbook](../docs/ops/runbook.md)), and ClamAV's `oom_score_adj` puts it before production's data services if the kernel has to choose; dev's containers should sit above it. Moving ClamAV to the standby next month frees 4 GiB.

### The seam for the dev environment

Dev is its own compose project with its own network, database, cache, buckets, volumes and secrets ([#235](https://github.com/shaiknoorullah/hg-mono/issues/235)). It touches this stack only through:

- **`hg-edge`** (172.30.1.0/24), a network Traefik joins and production's services do not. Dev's public containers join it and serve dev hosts; Traefik finds them through the socket proxy without a change to this file, but only names keep the two apart (below). Dev's own `HG_TRUSTED_PROXY_CIDRS` is that subnet.
- **ClamAV**, if dev scans with it: the scanner keeps no data. Dev reaches it on a network of its own, never on `hg-scan`, which would put dev's API beside production's.

Traefik reads the labels of every container on the box and merges routers, services and middlewares **by name** across them. A dev stack built from the base [`docker-compose.yml`](docker-compose.yml) inherits its `hg-api` and `hg-internal` labels, and compose merges list-form labels key by key, so adding `hg-dev-*` labels in an override does not remove them. Router `hg-api` would then be defined twice with different rules, and Traefik drops it: production's API answers 404. Service `hg-api` has the same load-balancer settings in both, so Traefik merges the two and sends production requests to dev's API and dev's database. Dev's override must therefore:

- use `labels: !override` on every service that carries labels in the base file (`api`), and on `minio` if dev routes it;
- start every router, service and middleware name with `hg-dev-`;
- carry `traefik.docker.network=hg-edge` on each container: Traefik's default network is `hg-net`, which dev's containers are not on.

Before dev's `up`, this must print nothing:

```sh
docker compose -p hg-dev <files> config \
  | grep -E 'traefik\.http\.(routers|services|middlewares)\.hg-' \
  | grep -v '\.hg-dev-'
```

Set these in `.env` beside the ones in [`.env.example`](.env.example). The stack refuses to start without them:

| Variable | Example |
|---|---|
| `HG_API_DIGEST`, `HG_MIGRATE_DIGEST`, `HG_POSTGRES_DIGEST` | `sha256:…`, the digest CI printed for `hg-api`, `hg-migrate` and `hg-postgres`. Only the digest is a variable, so a tag cannot slip in. `HG_IMAGE_REPO` defaults to `ghcr.io/shaiknoorullah` |
| `HG_API_HOST`, `HG_FILES_HOST` | `api.halalgoes.com`, `files.halalgoes.com` |
| `HG_UPLOAD_ORIGINS` | the admin and restaurant web origins, comma-separated |
| `ACME_EMAIL` | the address Let's Encrypt writes to about expiring certificates |
| `REDIS_PASSWORD`, `HG_APP_DATA_KEY` | `openssl rand -hex 32` |
| `HG_TRUSTED_PROXY_CIDRS` | keep the value from `.env.example`: the base file requires it, and the override replaces it with `hg-net`'s subnet |

Check the merged file before every change, then start it:

```bash
cd deploy
P="--env-file .env -f docker-compose.yml -f docker-compose.prod.yml"
docker compose $P config                     # only 80 and 443 published, no build:
docker compose $P --profile tools run --rm migrate
docker compose $P up -d
```

Migrations run first, as their own step, from a checkout of the release tag. API releases go through [docker-rollout](https://github.com/wowu/docker-rollout), which starts the new replicas before stopping the old ones; plain `up` recreates them and drops every WebSocket:

```bash
docker rollout $P -w 30 api
```

The first certificate takes a minute. For a first run on a new box, set `ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory` so failed attempts do not hit Let's Encrypt's rate limit, then remove it and the `letsencrypt` volume.

Not in this override yet, each tracked in its issue: the per-role connection limits ([#215](https://github.com/shaiknoorullah/hg-mono/issues/215)), GHCR images ([#78](https://github.com/shaiknoorullah/hg-mono/issues/78)), the replica's path to Postgres over WireGuard ([#210](https://github.com/shaiknoorullah/hg-mono/issues/210)), nginx for the static sites ([#213](https://github.com/shaiknoorullah/hg-mono/issues/213)), the API calling ClamAV ([#218](https://github.com/shaiknoorullah/hg-mono/issues/218)), and GlitchTip, Umami, the WireGuard-only admin routes and the deploy script ([#208](https://github.com/shaiknoorullah/hg-mono/issues/208)).
