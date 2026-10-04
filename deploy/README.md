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

- **Ports.** Only Traefik publishes, on 80 and 443 ([#200](https://github.com/shaiknoorullah/hg-mono/issues/200)). Nothing else is published, not even the Silo console: Silo is on internal networks only. The host can still reach it there, so tunnel to its fixed address, `ssh -L 9001:172.30.5.10:9001 prod`, then open `http://localhost:9001`.
- **TLS.** Port 80 only redirects to HTTPS. Certificates come from Let's Encrypt through the TLS-ALPN challenge on 443, and both public hosts send HSTS ([#51](https://github.com/shaiknoorullah/hg-mono/issues/51)). No dashboard; the access log keeps no headers.
- **The server.** The server playbook ([#276](https://github.com/shaiknoorullah/hg-mono/pull/276)) provides what this file assumes: the shared Docker networks, the Docker socket proxy, ClamAV, `.env` and the secret files. Its README section "What production's compose file must do" and this file must agree.
- **Networks, in tiers.** Each service joins only its tiers, every subnet is fixed, and every tier that needs no way out is internal. The full matrix, with subnets and owners, is at the top of [`docker-compose.prod.yml`](docker-compose.prod.yml):

  | Tier | Network | Internal | Members |
  |---|---|---|---|
  | edge | `hg-edge` | no | Traefik |
  | proxy | `hg-proxy` | yes | Traefik, API |
  | files | `hg-files` | yes | Traefik, Silo (the files route only) |
  | analytics | `hg-analytics-proxy` | yes | Traefik, Umami's web container |
  | app-data | `hg-data` | yes | API, Postgres, Valkey, migrations; the playbook's Postgres exporter |
  | storage | `hg-storage` | yes | API, Silo, the bucket job; the playbook's backups |
  | scan | `hg-scan` | yes | API, ClamAV |
  | egress | `hg-egress` | no | API: its only way out |
  | socket | `hg-socket` | yes | Traefik, the socket proxy |
  | monitoring | `hg-monitoring` | yes | the playbook's exporters and VictoriaMetrics; no production service yet |

  Traefik is on no data tier, so neither the edge nor the dev environment can reach Postgres, Valkey or Silo's S3 API. Postgres, Valkey and Silo have no route out. Clients reach them by production-only aliases, `hg-prod-postgres`, `hg-prod-valkey` and `hg-prod-silo`: Docker's DNS answers a name for every container on the network that claims it, so connecting by plain service names would let any container that joined as `postgres` take some of production's connections.
- **Docker socket.** Traefik reads container labels through the playbook's [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy), on `hg-socket`, which only the two of them join. The proxy answers reads of containers, events, ping and version, and refuses every POST: no exec, no container start, no volumes. It is the only container on the box that mounts the Docker socket.
- **Files host.** `files.<domain>` reaches Silo only for an object in one of the five buckets, with GET, HEAD, PUT or OPTIONS, and never with a copy-source, streaming-upload or replication header. `/minio/`, bucket listings and everything else get 404. Signed upload and download links are signed for this host (`HG_MINIO_PRESIGN_BASE_URL`, set by the override).
- **Client addresses.** Traefik and the API share `hg-proxy` (10.88.0.0/29), which nothing else joins, and the override sets `HG_TRUSTED_PROXY_CIDRS` to exactly that subnet, never a data tier or Docker's private ranges. Traefik trusts no forwarded headers (its entrypoints set no `forwardedHeaders.insecure` and no `forwardedHeaders.trustedIPs`), so it deletes any `X-Forwarded-For` a client sends and writes the address it saw. The API believes that header from Traefik and no one else. No dev container joins `hg-proxy`.
- **Secrets.** None is written in the files, and none has a default. Postgres, Silo, Valkey and the bucket job read theirs from read-only secret files (below), so the values are never in `docker inspect`, a command line or a log. The API and the migration runner are distroless binaries that read only environment variables, so theirs come from `.env`. The trade-off: whatever can inspect containers can read them, which is root on the box and Traefik, whose label reads through the socket proxy return each container's environment too. Moving them into files needs the API's config loader to accept `*_FILE` variables. `.env` is never committed.
- **Hardening.** Every container drops all Linux capabilities and adds back only what its entrypoint uses (Traefik binds 80 and 443; Postgres's entrypoint prepares its data directory as root, then switches user), cannot gain privileges through setuid binaries, and runs on a read-only root filesystem. None is privileged.
- **Virus scanning.** ClamAV is the playbook's, on `hg-scan` at 172.30.3.10:3310, until the standby takes it over; the API joins `hg-scan`, which only the two of them join. It must pass nothing unscanned: an upload over 16 MiB is refused with an `INSTREAM size limit exceeded` error, which the scanning worker must treat as not clean, and content that unpacks past 100 MiB is reported as found. The unpacking limits are 100 MiB rather than 16 because a clean scanned PDF can decompress past 16 MiB and would otherwise be reported as infected. Nothing calls it yet: the API's scanning worker is [#218](https://github.com/shaiknoorullah/hg-mono/issues/218).
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
| Traefik | 128 | `GOMEMLIMIT=96MiB`, 300 s read timeout on 443 for slow uploads |
| API × 2 | 2 × 320 | `GOMEMLIMIT=256MiB`, 1.5 CPUs, 8 database connections each |
| Postgres | 2,048 | `shared_buffers=512MB`, `effective_cache_size=1280MB`, `max_connections=60`, `shm_size` 256 MB |
| Valkey | 128 | `maxmemory 64mb`, `allkeys-lru` |
| Silo | 512 | `GOMEMLIMIT=400MiB`, 32 requests at once, slow scanner |
| **Run by the server playbook ([#276](https://github.com/shaiknoorullah/hg-mono/pull/276))** | | |
| Docker socket proxy | 48 | HAProxy measured 24 MB resident at idle and touched 32 MB while starting |
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

Dev is its own compose project with its own network, database, cache, buckets, volumes and secrets ([#235](https://github.com/shaiknoorullah/hg-mono/issues/235)), set up by the server playbook. It touches this stack only through:

- **Traefik**, which joins the playbook's `hg-dev-proxy` (10.88.0.8/29) and `hg-dev-edge` (172.30.11.0/24) to route the dev hosts. Production's services are on neither. Dev's API trusts `hg-dev-proxy` alone, and dev has its own networks, with different names and subnets: no dev container ever joins a production network. Traefik finds dev's containers through the socket proxy without a change to this file, but only names keep the two apart (below).
- **ClamAV**, if dev scans with it: the scanner keeps no data. Dev reaches it on a network of its own, never on `hg-scan`, which would put dev's API beside production's.

Traefik reads the labels of every container on the box and merges routers, services and middlewares **by name** across them. A dev stack built from the base [`docker-compose.yml`](docker-compose.yml) inherits its `hg-api` and `hg-internal` labels, and compose merges list-form labels key by key, so adding `hg-dev-*` labels in an override does not remove them. Router `hg-api` would then be defined twice with different rules, and Traefik drops it: production's API answers 404. Service `hg-api` has the same load-balancer settings in both, so Traefik merges the two and sends production requests to dev's API and dev's database. Dev's override must therefore:

- use `labels: !override` on every service that carries labels in the base file (`api`), and on `minio` if dev routes it;
- start every router, service and middleware name with `hg-dev-`;
- carry `traefik.docker.network` on each container, `hg-dev-proxy` for the API and `hg-dev-edge` for the rest: Traefik's default network is `hg-proxy`, which dev's containers are never on.

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
| `REDIS_PASSWORD`, `HG_APP_DATA_KEY` | `openssl rand -hex 32`. The Valkey password must be one word: Valkey reads it from a config line |
| `HG_TRUSTED_PROXY_CIDRS` | `10.88.0.0/29`. The base file requires it, and the override sets the API's to `hg-proxy`'s subnet whatever `.env` says |
| `HG_SECRETS_DIR` | optional; the folder holding the secret files, `/srv/hg/secrets` unless set |

`.env` still holds `POSTGRES_PASSWORD`, `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`, because the base file interpolates them and the API reads them. The containers that can read a file get the same values from the secret files instead, mounted read-only at `/run/secrets/<name>`. Compose bind-mounts each file as it is on the host, so each must be mode 0400 and owned by the user that reads it in the container:

| File in `$HG_SECRETS_DIR` | Value | Owner | Read by |
|---|---|---|---|
| `postgres_password` | `POSTGRES_PASSWORD` | root | Postgres's entrypoint, as root, before it switches to the `postgres` user |
| `redis_password` | `REDIS_PASSWORD` | uid 999 | Valkey, which runs as its image's `valkey` user (999:1000) |
| `minio_root_user` | `MINIO_ROOT_USER` | root | Silo and the bucket job |
| `minio_root_password` | `MINIO_ROOT_PASSWORD` | root | Silo and the bucket job |

Both `.env` and these files must be written by the playbook's secrets role from the same entries in `prod.sops.env`, so the two copies cannot differ.

Check the merged file before every change, then start it:

```bash
cd deploy
P="--env-file .env -f docker-compose.yml -f docker-compose.prod.yml"
docker compose $P config                     # only 80 and 443 published, no build:
docker compose $P --profile tools run --rm migrate
docker compose $P up -d
# Each network lists only its members in the table above:
for n in hg-edge hg-proxy hg-files hg-data hg-storage hg-egress; do
  docker network inspect "$n" -f '{{.Name}}: {{range .Containers}}{{.Name}} {{end}}'
done
```

Migrations run first, as their own step, from a checkout of the release tag. API releases go through [docker-rollout](https://github.com/wowu/docker-rollout), which starts the new replicas before stopping the old ones; plain `up` recreates them and drops every WebSocket:

```bash
docker rollout $P -w 30 api
```

The first certificate takes a minute. For a first run on a new box, set `ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory` so failed attempts do not hit Let's Encrypt's rate limit, then remove it and the `letsencrypt` volume.

Not in this override yet, each tracked in its issue: the per-role connection limits ([#215](https://github.com/shaiknoorullah/hg-mono/issues/215)), GHCR images ([#78](https://github.com/shaiknoorullah/hg-mono/issues/78)), the replica's path to Postgres over WireGuard ([#210](https://github.com/shaiknoorullah/hg-mono/issues/210); not a published port, which a container on internal networks only cannot have), nginx for the static sites ([#213](https://github.com/shaiknoorullah/hg-mono/issues/213)), the API calling ClamAV ([#218](https://github.com/shaiknoorullah/hg-mono/issues/218)), the pgBackRest mounts and WAL archiving the server playbook expects ([#64](https://github.com/shaiknoorullah/hg-mono/issues/64), [#276](https://github.com/shaiknoorullah/hg-mono/pull/276)), and GlitchTip, Umami, the WireGuard-only admin routes and the deploy script ([#208](https://github.com/shaiknoorullah/hg-mono/issues/208)).
