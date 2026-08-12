# hg-docker — Infrastructure Repo Analysis (Halal Goes Platform)

Analyzed: `/home/user/hg-docker` (all 8 files). Cross-referenced against `/home/user/hg-api` where required by scope.

## 1. Purpose & Role in the Platform

`hg-docker` is the **standalone deployment/distribution repo** for the Halal Goes platform. It exists so that anyone (frontend devs, testers, ops) can stand up the *entire* backend stack — database, cache, object storage, workflow engine, and the API itself — with a single `docker-compose up -d`, **without needing the `hg-api` source code**. The key difference from the compose file inside `hg-api` is that here the API runs from a **pre-built Docker Hub image** (`devsupreme0/halalgoes-api:${API_VERSION:-latest}`) instead of building from `./api` source. Everything else in the compose file is otherwise byte-for-byte the same as `/home/user/hg-api/docker-compose.yml` (verified by diff; only the `api` service `build:` → `image:` block and two blank lines differ).

The repo also doubles as the **integration documentation hub** for client-app teams: it ships the 2,498-line `ORDERS_API_INTEGRATION_GUIDE.md` (REST + WebSocket contract for the user/restaurant/rider apps) and the Hoppscotch API collection `API v1.2.25.json`.

File inventory (complete):

| File | Lines/Size | Role |
|---|---|---|
| `/home/user/hg-docker/docker-compose.yml` | 373 | 13-service full-stack compose |
| `/home/user/hg-docker/.env.example` | 67 | All env vars with defaults |
| `/home/user/hg-docker/README.md` | 303 | Setup, ops runbook, network map |
| `/home/user/hg-docker/ORDERS_API_INTEGRATION_GUIDE.md` | 2,498 | Client integration contract (REST + WS) |
| `/home/user/hg-docker/API v1.2.25.json` | 4,292 (Hoppscotch v10 export) | 56-request API collection, 9 folders |
| `/home/user/hg-docker/redis/master/redis.conf` | 8 | Redis master config (likely orphaned — see §9) |
| `/home/user/hg-docker/redis/sentinel.conf` | 8 | Sentinel config (unused — see §9) |
| `/home/user/hg-docker/.gitignore` | 15 | Ignores `.env`, `data/`, `volumes/`, logs, OS files |

---

## 2. docker-compose.yml — Complete Service Inventory

Network: single bridge `halalgoes-network`, subnet `172.21.0.0/16`, **static IPv4 per container**.

| # | Service | Container name | Image (pinning) | Static IP | Host ports | Depends on |
|---|---|---|---|---|---|---|
| 1 | postgres | `postgres-halalgoes` | `postgis/postgis:17-3.6-alpine` (pinned) | 172.21.0.10 | `${POSTGRES_PORT:-5432}:5432` | — |
| 2 | pgbouncer | `pgbouncer-halalgoes` | `edoburu/pgbouncer:v1.24.1-p1` (pinned) | 172.21.0.11 | `${PGBOUNCER_PORT:-6432}:6432` | postgres (healthy) |
| 3 | pgadmin | `pgadmin-halalgoes` | `dpage/pgadmin4:latest` (unpinned) | 172.21.0.12 | `${PGADMIN_PORT:-5050}:80` | postgres (healthy) |
| 4 | redis-master | `redis-master` | `redis:latest` (unpinned) | 172.21.0.3 | `${REDIS_MASTER_PORT:-6379}:6379` | — |
| 5 | redis-slave-1 | `redis-slave-1` | `redis:latest` | 172.21.0.4 | **none** | redis-master (healthy) |
| 6 | redis-slave-2 | `redis-slave-2` | `redis:latest` | 172.21.0.5 | **none** | redis-master (healthy) |
| 7 | sentinel-1 | `sentinel-1` | `redis:latest` | 172.21.0.6 | `${REDIS_SENTINEL_1_PORT:-26379}:26379` | redis-master |
| 8 | sentinel-2 | `sentinel-2` | `redis:latest` | 172.21.0.7 | `${REDIS_SENTINEL_2_PORT:-26380}:26379` | redis-master |
| 9 | redisinsight | `redisinsight` | `redis/redisinsight:latest` | 172.21.0.9 | `5540:5540` (hardcoded) | — |
| 10 | minio | `hg-file-storage` | `minio/minio:RELEASE.2025-04-22T22-12-26Z` (pinned) | 172.21.0.20 | `${MINIO_API_PORT:-9000}:9000`, `${MINIO_CONSOLE_PORT:-9001}:9001` | — |
| 11 | temporal | `temporal` | `temporalio/auto-setup:latest` (unpinned) | 172.21.0.13 | `${TEMPORAL_PORT:-7233}:7233` | postgres (healthy) |
| 12 | temporal-admin-tools | `temporal-admin-tools` | `temporalio/admin-tools:latest` | 172.21.0.14 | none (`stdin_open`+`tty`) | temporal |
| 13 | temporal-ui | `temporal-ui` | `temporalio/ui:latest` | 172.21.0.15 | `${TEMPORAL_UI_PORT:-8080}:8080` | temporal |
| 14 | api | `halalgoes-api` | `devsupreme0/halalgoes-api:${API_VERSION:-latest}` | 172.21.0.100 | `${API_PORT:-3456}:3456`, `${WS_PORT:-9080}:9080` | temporal, postgres, redis-master, minio (no health conditions) |

Named volumes declared: `postgres_data`, `pgadmin_data`, `redis_replica1_data`, `redis_replica2_data`, `redis_sentinel_data` (**declared but never mounted**), `minio_data`, `temporal_config` (**declared but never mounted**). Note **redis-master has no data volume** despite `appendonly yes` — AOF lives in the container layer and is lost on container removal.

### Service configuration detail

**postgres** — PostGIS-enabled (geo queries for rider search/feed). `POSTGRES_INITDB_ARGS: --encoding=UTF-8 --lc-collate=C --lc-ctype=C`. Healthcheck `pg_isready` q/5s/10s/5 retries/30s start.

**pgbouncer** — `AUTH_TYPE: md5`, `POOL_MODE: transaction`, defaults MAX_CLIENT_CONN=100, DEFAULT_POOL_SIZE=20, MIN_POOL_SIZE=5, RESERVE_POOL_SIZE=5, SERVER_LIFE_TIME=3600, SERVER_IDLE_TIMEOUT=600, SERVER_CONNECT_TIMEOUT=15, CLIENT_LOGIN_TIMEOUT=60, QUERY_WAIT_TIMEOUT=120, ADMIN_USERS=`postgres,dbuser`. **The API does not use it** — `DATABASE_URL` points straight at `postgres-halalgoes:5432` (see §5). PgBouncer is effectively deployed-but-bypassed.

**redis-master** — mounts `./config/redis/master/redis.conf:/usr/local/etc/redis/redis.conf` and runs `redis-server /usr/local/etc/redis/redis.conf --appendonly yes --repl-diskless-load on-empty-db --replica-announce-ip ${HOST_IP} --replica-announce-port 6379 --protected-mode no`. **Path bug:** the repo stores the conf at `./redis/master/redis.conf`, not `./config/redis/master/...` — the `config/` directory does not exist, so Docker bind-creates an empty *directory* at the mount target and `redis-server` is handed a directory as its config file (startup failure or config silently ignored depending on Docker behavior).

**redis-slave-1/2** — pure CLI config (no conf file): `--replicaof redis-master 6379 --appendonly yes --repl-diskless-load on-empty-db --replica-announce-ip ${HOST_IP} --replica-announce-port 6380|6381 --protected-mode no`. They announce host ports 6380/6381 to Sentinel, **but no host port mappings exist for the slaves**, so external clients redirected by Sentinel to `${HOST_IP}:6380/6381` hit nothing.

**sentinel-1/2** — config is generated inline via `sh -c 'echo ... > /etc/sentinel.conf && redis-sentinel /etc/sentinel.conf'`:
```
bind 0.0.0.0
sentinel monitor mymaster ${HOST_IP} 6379 2
sentinel resolve-hostnames yes
sentinel down-after-milliseconds mymaster 10000
sentinel failover-timeout mymaster 10000
sentinel parallel-syncs mymaster 1
```
Monitored master name: **`mymaster`**, quorum **2** with only **2 sentinels** (no majority tolerance — one sentinel down ⇒ no failover possible; standard practice is 3). Sentinels monitor `${HOST_IP}:6379` (the host-published master port) rather than the container IP. sentinel-1 has **no healthcheck**; sentinel-2's healthcheck runs `redis-cli -p 26380 ping` *inside* the container where Sentinel listens on 26379 (26380 is only the host mapping) — **this healthcheck can never pass**.

**minio** — `server /data --console-address ":9001"`; env `MINIO_ROOT_USER` (default `admin`), `MINIO_ROOT_PASSWORD` (required), `MINIO_BROWSER=on`, `MINIO_REGION=us-east-1`. Healthcheck curls `/minio/health/live`. Buckets are **manually created** per README: `profile-pictures`, `restaurant-images`, `food-images` (via `mc alias set local ...` + `mc mb`).

**temporal** — `auto-setup` image, persistence `DB: postgres12` sharing the same PostgreSQL instance (`POSTGRES_SEEDS: postgres` — note this references the *service* name, while other services use container name `postgres-halalgoes`; Docker resolves both). Namespace: `default` (`TEMPORAL_NAMESPACE` env for the API). admin-tools uses `tctl` (README: `tctl --namespace default namespace describe`).

**api** — full environment:
```
NODE_ENV: production
PORT: ${API_PORT:-3456}
DATABASE_URL:  postgresql://${HG_DB_USER}:${HG_DB_PASS}@postgres-halalgoes:5432/${HG_DB}?schema=public
DB_DIRECT_URL: (identical — both bypass pgbouncer)
REDIS_HOST: redis-master   REDIS_PORT: 6379   REDIS_DB: 0
REDIS_KEYSPACE_NOTIFICATIONS: Ex        # keyspace expiry events — used for TTL-driven logic (e.g. rider-request expiry)
TEMPORAL_ADDRESS: temporal:7233
TEMPORAL_NAMESPACE: ${TEMPORAL_NAMESPACE:-default}
MINIO_ACCESS_KEY: ${MINIO_ROOT_USER:-admin}   MINIO_ACCESS_SECRET: ${MINIO_ROOT_PASSWORD}
```
The API uses the MinIO **root credentials** as its access key. `depends_on` for api uses bare form (no `condition: service_healthy`), so the API can start before Postgres/Temporal are actually ready.

---

## 3. Environment Variables (.env.example — complete)

**Required (no default):** `HG_DB_PASS` (Postgres), `PGADMIN_PASS`, `MINIO_ROOT_PASSWORD` (min 8 chars), `HOST_IP` (machine LAN IP, e.g. 192.168.1.100 — used by Redis replica announce + Sentinel monitor; must NOT be 127.0.0.1).

**Optional with defaults:** `HG_DB=halalgoes_db`, `HG_DB_USER=postgres`, `POSTGRES_PORT=5432`; the 10 `PGBOUNCER_*` vars listed in §2; `PGADMIN_EMAIL=admin@example.com`, `PGADMIN_PORT=5050`; `REDIS_MASTER_PORT=6379`, `REDIS_SENTINEL_1_PORT=26379`, `REDIS_SENTINEL_2_PORT=26380`; `MINIO_ROOT_USER=admin`, `MINIO_BROWSER=on`, `MINIO_REGION=us-east-1`, `MINIO_API_PORT=9000`, `MINIO_CONSOLE_PORT=9001`; `TEMPORAL_PORT=7233`, `TEMPORAL_UI_PORT=8080`, `TEMPORAL_NAMESPACE=default`; `DOCKER_USERNAME=devsupreme0` (**declared in .env.example but never referenced in docker-compose.yml** — the image name hardcodes `devsupreme0/`), `API_VERSION=latest`, `API_PORT=3456`, `WS_PORT=9080`.

---

## 4. Redis Config Files (repo copies)

`/home/user/hg-docker/redis/master/redis.conf`:
```
bind 0.0.0.0
protected-mode no
port 6379
appendonly yes
appendfsync everysec
save 900 1
save 300 10
save 60 10000
```
(AOF everysec + classic RDB snapshot triggers.)

`/home/user/hg-docker/redis/sentinel.conf`:
```
bind 0.0.0.0
protected-mode no
port 26379
dir /tmp
sentinel monitor mymaster redis-master 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 10000
sentinel parallel-syncs mymaster 1
```
**This file is dead config** — the compose sentinels generate their own conf inline (with different values: `down-after` 10000 vs 5000 here, and monitor target `${HOST_IP}` vs `redis-master` here). The master conf is *intended* to be mounted but the mount path is wrong (§2/§9). No `requirepass`/ACL anywhere: Redis is unauthenticated, `protected-mode no`, published on the host.

---

## 5. Integration Points (how this stack wires the platform together)

- **API base URL:** `http://localhost:3456` (dev) / `https://api.halalgoes.com` (prod). **WebSocket:** `ws://localhost:9080` (dev) / `wss://ws.halalgoes.com` (prod). Both ports come from one `api` container.
- **API docs endpoint:** `http://localhost:3456/api-docs` (Scalar API Reference).
- **DB:** API → `postgres-halalgoes:5432` directly (PgBouncer at 6432 is unused by the API); Temporal → same Postgres (`postgres12` plugin, `POSTGRES_SEEDS: postgres`).
- **Redis:** API → `redis-master:6379`, DB 0, keyspace notifications `Ex` (expired-event class) — the mechanism behind TTL-based flows such as rider delivery-request expiry (`expiresAt` = +5 min in the delivery request payload). Redis key documented in the guide: **`order_checkout_mapping:{orderId}:{restaurantId}`** (checkout↔restaurant mapping; auto-cancel+refund when it expires). Redis also holds the **rider active pool** (toggling availability adds/removes the rider) and WebSocket channel management.
- **Temporal:** API → `temporal:7233`, namespace `default`. Workflows referenced by the guide: **checkout saga**, **order tracking workflow** (5-hour timeout → `ORDER_TIMEOUT` broadcast + cancel/refund), **rider assignment workflow**. Restaurant accept/reject and rider accept/reject "signal" these workflows (`signaled: true` in responses); status updates return `"Workflow not found or has already completed"` on stale workflows.
- **MinIO:** API uses root creds; buckets `profile-pictures`, `restaurant-images`, `food-images`.
- **WebSocket channels:** per-order channel **`order:{orderId}`** joined by user, restaurant, and rider.
- **Docker Hub:** `https://hub.docker.com/r/devsupreme0/halalgoes-api/tags` is the release channel; version pinning via `API_VERSION`.
- **GitHub:** issues at `https://github.com/shaiknoorullah/hg-docker/issues`; guide maintained by Shaik Noorullah.

---

## 6. ORDERS_API_INTEGRATION_GUIDE.md — Protocol Contract (v1.2.25, dated 2025-10-02; footer "Document Version 1.0.0, Last Updated 2025-10-05")

### Order lifecycle & saga
Cart → **mandatory** `GET /pricing/:cartId` (client-side pricing fetch, validated server-side at checkout; **deprecation notice: manual pricing call to be removed in v2.0** when checkout computes pricing server-side) → `PUT /orders/checkout/:cartId` → payment → order creation → restaurant notification (WS `order_request`) → accept/reject → rider assignment (broadcast to nearby riders, first-accept wins, 5-min request expiry) → tracking → delivery.

### Order statuses (full enum)
`PENDING_PAYMENT` → `PLACED` → `CONFIRMED` → `PREPARING` → `RIDER_ASSIGNED` → `PICKED_UP` → `ON_THE_WAY` → `DELIVERED`; alternates: `REJECTED` (restaurant), `CANCELLED` (system/user), `DISPUTED` (post-delivery). Transition table: PLACED→CONFIRMED/REJECTED (restaurant), CONFIRMED→PREPARING (restaurant), PREPARING→RIDER_ASSIGNED (system, on rider accept), RIDER_ASSIGNED→PICKED_UP→ON_THE_WAY→DELIVERED (rider), any-pre-DELIVERED→CANCELLED (system on timeout/failure).

### Checkout WS steps (`notification` event, `type: "checkout_update"`)
`INITIATED`, `PAYMENT_PROCESSING`, `ORDER_CREATING`, `ORDER_CREATED` (carries `data.order_id`), `RESTAURANT_NOTIFYING`, `WAITING_RESTAURANT_ACCEPTANCE`, `RIDER_ASSIGNMENT`, `ORDER_CHANNEL_CREATED` (carries `data.tracking_workflow_id`), `CART_CLEARED`, `COMPLETED`, `FAILED` (carries `error`).

### WebSocket protocol (ws://localhost:9080)
Client→server events: `connect_user` `{userId, userType}` (userType ∈ `user`|`restaurant`|`rider`), `join_channel` `{channelName, userId, userType}`, `heartbeat`, `status`, `health_check`. Server→client: `connection_confirmed` (includes `queuedNotificationsDelivered` — offline notification queue replayed on reconnect), `channel_joined`, `order_update` (`type` ∈ `ORDER_STATUS_UPDATE` | `RIDER_LOCATION_UPDATE` | `TRACKING_STARTED` | `ORDER_TIMEOUT`; fields orderId, status, source `restaurant`|`rider`, message, timestamp, optional `location{latitude,longitude}`), `order_request` (to restaurant: customer/items/total/deliveryAddress; to rider: restaurant+customer+addresses with coordinates, `distance` km, `deliveryFee`, `estimatedTime` min, `expiresAt` = timestamp+5 min), `notification`, `connection_error`, `channel_error`, `status_response` (`connectedClients`, `uptime`, `startTime`), `health_check_response`.

### Endpoints documented in the guide (with semantics)
- `GET /carts/:userId`; `PUT /carts/:userId` (guide shows body `{items:[{food_item_id,quantity,variant_id}], restaurant_id}`; quantity 0 removes; single-restaurant rule; **collection uses a different shape** — see §9).
- `GET /pricing/:cartId` → `{item_total, delivery_fee, platform_fee, discount_amount, amount_to_pay}` (400 "Cart is empty", 404 "Cart not found").
- `PUT /orders/checkout/:cartId` — body `{user_id, delivery_address_id, payment_method_id, pricing, metadata}`; `metadata.delivery_instructions` enum array: `DO_NOT_CALL` | `DO_NOT_RING_BELL` | `LEAVE_AT_DOOR`; `metadata.special_instructions` free text.
- `GET /orders/user/:userId`, `GET /orders/:orderId`, `GET /orders/:orderId/tracking`, `GET /orders/analytics/user/:userId`.
- Restaurant: `GET /restaurants/:restaurantId/orders?status=...`; `PUT /restaurants/:restaurantId/orders/:orderId?action=accept&estimatedPrepTime=N` (default prep 25 min) / `?action=reject&reason=...` (reason required; triggers auto-refund); `PUT /restaurants/orders/:orderId/status` body `{status}` (only CONFIRMED→PREPARING).
- Rider: `PUT /riders/:riderId/availability` body `{lat,lng}` (toggle; online adds to Redis active pool; auto-set false on accepting an order; manual re-enable after delivery); `PUT /riders/:riderId/location` body `{latitude, longitude, orderId?}` (orderId routes to tracking workflow → `RIDER_LOCATION_UPDATE` broadcast; recommend 10–30 s cadence); `PUT /riders/:riderId/orders/:orderId?action=accept|reject[&reason]`; `PUT /riders/:riderId/orders/:orderId/status?status=...` plus **global alternative** `PUT /riders/orders/:orderId/status` (body `{status}`); `GET /riders/:riderId/orders`.
- Errors: standard Nest `{statusCode, message, error}` 400/404/500; workflow-update failure `{success:false, error:"Workflow not found or has already completed"}`.
- Timeouts/magic numbers: **restaurant should respond within ~2 min**; **rider request expiry 5 min**; **tracking workflow limit 5 hours**; default `estimatedPrepTime` 25 min; recommended client polling fallback 30 s; reconnect backoff `min(1000*2^n, 30000)`, max 10 attempts; location batching example 15 s.

Client patterns documented: polling+WS hybrid, **pessimistic UI updates (recommended)**, channel manager, resilient reconnect with queued-notification replay, location batching.

### Rider entity fields (from availability response)
`id, first_name, last_name, phone, phone_verified, email, email_verified, identity_docs[], is_accepting_orders, total_earnings (string decimal), total_orders_delivered, rating_avg (string decimal), is_deleted, deleted_at, deleted_by, created_at, last_modified_at` (soft-delete pattern; monetary/ratings as string decimals).

---

## 7. API v1.2.25.json — Hoppscotch Collection (v10 format, 56 requests, 9 folders)

Collection id `cmfuekiug0lrrif1lff1xwrbz`, auth `inherit`, no collection headers/variables. All endpoints hardcode `http://localhost:3456` with literal UUIDs (no Hoppscotch variables).

### Complete endpoint inventory

**Users (6):** `POST /users` (body: first_name, last_name, email, phone); `PUT /users/:id` (e.g. `{phone_verified:true}`); `POST /users/:id/addresses` (fields: latitude, longitude, name, postal_code, street, apartment, floor, is_primary, landmark, suburb, is_third_person, third_person_name, third_person_phone); `GET /users/:id/addresses`; `GET /users/:id` (misnamed "get-user-analytics"); `GET /users/:id/analytics` (misnamed "get-user-by-id" — the two names are swapped).

**Riders (12):** `POST /riders`; `GET /riders/:id`; `PUT /riders/:id` (`{email_verified, phone_verified, is_accepting_orders}`); `PUT /riders/:id/location` (`{latitude, longitude}`); `PUT /riders/:id/availability` (`{lat, lng}` — note different field names than /location; request titled "toggle-rider-availability - Duplicate"); `GET /riders/nearby/search?lat&lng&radius` (radius km); `GET /riders/active/all`; `GET /riders/:id/stats`; `PUT /riders/:id/orders/:orderId/status?status=PICKED_UP`; `PUT /riders/:id/orders/:orderId?action=accept`; `GET /riders/:id/orders`; `GET /riders/:id/orders/:orderId`.

**Restaurants (10):** `POST /restaurants/` — nested body `{data:{is_halal_certified, halal_certification_expiry, is_approved, approved_at, name, description, opening_time, closing_time, is_accepting_orders}, location:{street_address, suburb, city, country, postal_code}, coords:{lat,lng}}`; `GET /restaurants/:id` (titled "get-restaurand-by-id" — typo); `PUT /restaurants/:id` (`{is_approved:true}` — approval settable directly, bypassing admin approve endpoint); `GET /restaurants/:id/menu`; `POST /restaurants/:id/menu/items` — array of `{item_name, item_description, item_price, is_non_veg, contains_diary [sic], ingredients[], allergens[], item_images[], category_name, cuisine_name, variants:[{type:"SIZE", name, description, price, isDefault}]}`; `PUT /restaurants/menu-items/:itemId`; `PUT /restaurants/:id/toggle-accepting` (`{is_accepting}`); `GET /restaurants/:id/orders`; `GET /restaurants/:id/stats`; `PUT /restaurants/:id/orders/:orderId?action=accept`.

**Carts (2):** `GET /carts/:userId`; `PUT /carts/:userId` — body `{delivery_address_id, cart_items:[{food_item_id, quantity, selected_variant_id, selected_addon_ids[]}], coupon_codes:[]}` (auth explicitly `none` on this one request).

**Feed (2):** `GET /feed/:userId?lat&lng` (geo-personalized feed); `GET /feed/:userId/search?q&limit=20&page=1`.

**Payments (5):** `POST /payments/users/:userId/method` (`{payment_method:"CREDIT_CARD"}`); `PUT /payments/carts/:cartId` (`{user_id, payment_method_id}`); `GET /payments/:paymentId`; "list-payments" `GET /payments/:paymentId` (**identical URL to get-by-id — list URL is wrong/copy-paste**); `POST /payments/:paymentId/refund` (`{}`).

**Pricing (1):** `GET /pricing/:cartId`.

**Orders (6):** `PUT /orders/checkout/:cartId` — body includes `pricing.coupons_applied: []` (a field NOT shown in the integration guide's pricing object), item_total 141.9, delivery_fee 10.3, platform_fee 5, discount_amount 0, amount_to_pay 157.2, `metadata.delivery_instructions: []`; `GET /orders/:orderId/tracking`; `GET /orders/analytics/user/:userId`; `GET /orders/:orderId`; `GET /orders/user/:userId`; `GET /orders/restaurant/:restaurantId` (overlaps with `/restaurants/:id/orders`).

**Admin (8):** `GET https://echo.hoppscotch.io` (dead placeholder titled "aprove-restaurant" [sic]); `POST /admin` (`{}` body — create admin account with no fields); `POST /admin/restaurants/:id/approve` (`{admin_id}`); `POST /admin/riders/:id/approve` (`{admin_id}`); `GET /admin/users?limit=20&offset=0`; `GET /admin/restaurants?limit&offset`; `GET /admin/riders?limit&offset`; `GET /admin/analytics`.

**Ratings (4):** `POST /ratings/riders/:riderId` and `POST /ratings/food-items/:itemId` (`{user_id, rating (float, e.g. 4.5), review, images[]}`); `GET /ratings/riders/:riderId`; `GET /ratings/food-items/:itemId`.

### v1.2.25 vs v1.2.23 (in /home/user/hg-api)
**The two files are byte-identical except the collection `name` field** (`"API v1.2.23"` → `"API v1.2.25"`; same collection id, same 56 requests, same bodies/params — verified by full JSON diff: 1 changed line). So v1.2.25 introduces **zero endpoint changes** at the collection level; the version bump reflects backend/image changes (the README pins example `API_VERSION=1.2.25`), not API-surface changes. (hg-api also holds an older `API v1.0.10.json`.)

---

## 8. Auth / Security Model

- **No authentication anywhere in the documented API surface.** Every REST call in the guide and collection is unauthenticated (collection auth = inherit/none; no Authorization headers; JWT/session absent). Identity is claimed via path params (`:userId`, `:riderId`) and body fields — any caller can act as any user/restaurant/rider/admin.
- **WebSocket "authentication" is just `connect_user {userId, userType}`** — self-asserted, no token.
- **Redis:** `protected-mode no`, `bind 0.0.0.0`, no `requirepass`, master published on host port 6379; sentinels also unauthenticated and published.
- **Postgres** published on host 5432; **pgAdmin** runs with `PGADMIN_CONFIG_ENHANCED_COOKIE_PROTECTION: "False"`.
- **MinIO:** API uses root credentials (`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`) rather than a scoped service account.
- Secrets are env-injected (`.env` git-ignored; `.env.example` has placeholders only — no committed secrets), which is the one solid practice here.
- Admin endpoints (`POST /admin`, approve endpoints, `/admin/analytics`) equally unauthenticated; `PUT /restaurants/:id {is_approved:true}` bypasses the admin approval flow entirely.

---

## 9. Code-Quality Observations, Bugs, Inconsistencies

**Compose/config bugs**
1. **Broken redis.conf mount path:** compose mounts `./config/redis/master/redis.conf` but the file lives at `./redis/master/redis.conf` → Docker creates an empty dir at the mount point; master config (AOF fsync policy, save points) is not actually applied as written.
2. **`redis/sentinel.conf` is dead code** — sentinels build their conf inline with *different* values (down-after 10000 vs file's 5000; monitor `${HOST_IP}` vs file's `redis-master`).
3. **sentinel-2 healthcheck can never pass** (`redis-cli -p 26380 ping` inside a container listening on 26379); sentinel-1 has no healthcheck at all.
4. **2 sentinels with quorum 2** — failover requires sentinel majority; one sentinel outage disables failover (should be 3 sentinels).
5. **Replica announce ports 6380/6381 are never published** — Sentinel-directed clients outside Docker can't reach replicas.
6. **redis-master has no persistent volume** (replicas do) — master AOF/RDB lost with the container.
7. **Unused volumes:** `redis_sentinel_data`, `temporal_config` declared but never mounted.
8. **PgBouncer deployed but bypassed** — both `DATABASE_URL` and `DB_DIRECT_URL` hit Postgres directly.
9. **`DOCKER_USERNAME` env var documented but unused** (image name hardcodes `devsupreme0/`).
10. `api.depends_on` lacks health conditions (bare list), so the API can race its dependencies; `redisinsight` port 5540 hardcoded (only unparameterized port).
11. Unpinned `latest` tags for redis, pgadmin, redisinsight, all three temporal images (supply-chain/reproducibility risk); postgres, pgbouncer, minio are pinned.

**Docs/collection inconsistencies**
12. **Cart contract mismatch:** guide says `PUT /carts/:userId` takes `{items:[{food_item_id, quantity, variant_id}], restaurant_id}`; collection sends `{delivery_address_id, cart_items:[{food_item_id, quantity, selected_variant_id, selected_addon_ids}], coupon_codes}` — field names and structure disagree; one of the two is stale.
13. **Pricing object mismatch:** collection checkout includes `pricing.coupons_applied[]`; guide's pricing/checkout examples omit it.
14. **"API v1.2.25.json" is a renamed copy of v1.2.23** — no actual API-surface diff; version bump is cosmetic at the collection level.
15. Collection defects: "list-payments" URL identical to get-payment-by-id; dead `https://echo.hoppscotch.io` request; swapped names on Users get-by-id/analytics; typos ("get-restaurand-by-id", "aprove-restaurant", `contains_diary`); "- Duplicate" suffix left on a request; several GET requests carry leftover JSON bodies (get-rider-by-id, list-orders-for-rider, search-riders, get-orders-for-restaurant with an unrelated `{is_accepting:true}` body).
16. Inconsistent coordinate field naming across endpoints: `{latitude, longitude}` (rider location) vs `{lat, lng}` (availability, feed, nearby search, restaurant coords).
17. **Real PII committed in the collection:** a real-looking email (`mfaizan@websleak.com`), Indian phone numbers (+9188..., +9176...), and full Hyderabad street addresses used as sample data.
18. Guide metadata inconsistency: header "Version 1.2.25 / Last Updated 2025-10-02" vs footer "Document Version 1.0.0 / Last Updated 2025-10-05".
19. Rejected-order flow ambiguity: guide's status diagram says restaurant rejection sets `REJECTED`, but the checkout-failure section says checkout step `FAILED` + refund; acceptance sets CONFIRMED before PREPARING while the transition table also shows PREPARING→RIDER_ASSIGNED — meaning rider assignment starts only after PREPARING per the table, but the lifecycle text says assignment starts right after acceptance. Minor doc drift.
20. `.gitignore` references `data/` and `volumes/` dirs that don't exist in-repo (harmless, defensive).

**Notable magic values recap:** subnet 172.21.0.0/16 with static IPs (API at .100); master name `mymaster`; 5 h tracking timeout; 5 min rider-offer expiry; ~2 min restaurant response expectation; 25 min default prep time; Redis notif class `Ex`; buckets profile-pictures/restaurant-images/food-images.

---

## 10. How hg-docker Relates to the Other Repos

- **hg-api:** same compose topology (verified identical except API `build:` vs `image:`); hg-api holds `API v1.2.23.json` (byte-equal content) plus deeper docs (`REDIS_DATA_STRUCTURE.md`, `COMPREHENSIVE_ORDER_FLOW_DOCUMENTATION.md`). hg-docker is the consumer-facing distribution of that backend as `devsupreme0/halalgoes-api` images.
- **halal-goes (frontend monorepo):** the integration guide is the de-facto contract the Expo apps (users, rider, restaurant) and Next.js webs implement — REST on :3456, WS protocol on :9080, `order:{orderId}` channels, checkout step machine, and status enums all originate here.
