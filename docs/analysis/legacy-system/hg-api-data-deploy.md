# hg-api: Data Layer & Deployment — Exhaustive Analysis

Area: `/home/user/hg-api` — Prisma schema/migrations/seed, docker-compose stack, Redis/Sentinel config, custom Postgres + PgBouncer images, Temporal server config, API build/test/release tooling, and the `gen-userlist.sh` helper.

---

## 1. Purpose & Role in the Platform

This area is the persistence and infrastructure backbone of the HalalGoes food-delivery platform. It defines:

- The **entire relational data model** (PostgreSQL 17 + PostGIS 3.6 via Prisma 6.16) for users, riders, restaurants, menus, carts, orders, payments, coupons, reviews, and admin approvals.
- The **local/production docker-compose deployment**: Postgres, PgBouncer, pgAdmin, a Redis master + 2 replicas + 2 Sentinels HA cluster, RedisInsight, MinIO object storage, a full Temporal server stack (server + admin-tools + UI), and the NestJS API container itself.
- **Build & release machinery**: multi-stage API Dockerfile that auto-runs Prisma migrations on boot, release-it based semver + Docker Hub publishing.
- Supporting config for connection pooling (PgBouncer), Postgres tuning, and Temporal dynamic config.

Everything else in the platform (NestJS services in `api/src`, the Expo/Next.js frontends in `halal-goes`, the infra repo `hg-docker`) sits on top of the schema and services defined here.

---

## 2. Deployment Inventory (docker-compose.yml, 372 lines)

Network: `halalgoes-network`, bridge, subnet **172.21.0.0/16** with static IPs per container.

| Service | Container | Image | Static IP | Host Ports (env override) | Notes |
|---|---|---|---|---|---|
| postgres | postgres-halalgoes | `postgis/postgis:17-3.6-alpine` | 172.21.0.10 | `${POSTGRES_PORT:-5432}:5432` | `POSTGRES_INITDB_ARGS: --encoding=UTF-8 --lc-collate=C --lc-ctype=C`; healthcheck `pg_isready` q 5s/10s/5 retries/30s start; volume `postgres_data` |
| pgbouncer | pgbouncer-halalgoes | `edoburu/pgbouncer:v1.24.1-p1` | 172.21.0.11 | `${PGBOUNCER_PORT:-6432}:6432` | AUTH_TYPE=md5, POOL_MODE=transaction, MAX_CLIENT_CONN 100, DEFAULT_POOL_SIZE 20, MIN 5, RESERVE 5, SERVER_LIFE_TIME 3600, SERVER_IDLE_TIMEOUT 600, SERVER_CONNECT_TIMEOUT 15, CLIENT_LOGIN_TIMEOUT 60, QUERY_WAIT_TIMEOUT 120, ADMIN_USERS `postgres,dbuser` |
| pgadmin | pgadmin-halalgoes | `dpage/pgadmin4:latest` | 172.21.0.12 | `${PGADMIN_PORT:-5050}:80` | `PGADMIN_DISABLE_POSTFIX=true`, `PGADMIN_CONFIG_ENHANCED_COOKIE_PROTECTION=False`; volume `pgadmin_data` |
| redis-master | redis-master | `redis:latest` | 172.21.0.3 | `${REDIS_MASTER_PORT:-6379}:6379` | mounts `./config/redis/master/redis.conf`; flags: `--appendonly yes --repl-diskless-load on-empty-db --replica-announce-ip ${HOST_IP} --replica-announce-port 6379 --protected-mode no` |
| redis-slave-1 | redis-slave-1 | `redis:latest` | 172.21.0.4 | none published | `--replicaof redis-master 6379`, announce-port 6380; volume `redis_replica1_data` |
| redis-slave-2 | redis-slave-2 | `redis:latest` | 172.21.0.5 | none published | announce-port 6381; volume `redis_replica2_data` |
| sentinel-1 | sentinel-1 | `redis:latest` | 172.21.0.6 | `${REDIS_SENTINEL_1_PORT:-26379}:26379` | conf generated inline: `sentinel monitor mymaster ${HOST_IP} 6379 2`, down-after 10000ms, failover-timeout 10000, parallel-syncs 1, resolve-hostnames yes. **No healthcheck** (sentinel-2 has one) |
| sentinel-2 | sentinel-2 | `redis:latest` | 172.21.0.7 | `${REDIS_SENTINEL_2_PORT:-26380}:26379` | same inline conf; healthcheck `redis-cli -p 26380 ping` (checks wrong port inside container — sentinel listens on 26379 internally) |
| redisinsight | redisinsight | `redis/redisinsight:latest` | 172.21.0.9 | `5540:5540` (hardcoded) | no restart policy, no healthcheck |
| minio | hg-file-storage | `minio/minio:RELEASE.2025-04-22T22-12-26Z` | 172.21.0.20 | `${MINIO_API_PORT:-9000}:9000`, `${MINIO_CONSOLE_PORT:-9001}:9001` | `server /data --console-address ":9001"`; MINIO_ROOT_USER default `admin`; region default `us-east-1`; healthcheck `/minio/health/live` |
| temporal | temporal | `temporalio/auto-setup:latest` | 172.21.0.13 | `${TEMPORAL_PORT:-7233}:7233` | `DB=postgres12`, seeds into the same app Postgres (`POSTGRES_SEEDS: postgres`) using HG_DB_USER/HG_DB_PASS |
| temporal-admin-tools | temporal-admin-tools | `temporalio/admin-tools:latest` | 172.21.0.14 | none | `TEMPORAL_ADDRESS=temporal:7233`, tty+stdin_open |
| temporal-ui | temporal-ui | `temporalio/ui:latest` | 172.21.0.15 | `${TEMPORAL_UI_PORT:-8080}:8080` | |
| api | halalgoes-api | built from `./api/Dockerfile` | 172.21.0.100 | `${API_PORT:-3456}:3456`, `${WS_PORT:-9080}:9080` | see §6 env table |

Declared volumes: `postgres_data`, `pgadmin_data`, `redis_replica1_data`, `redis_replica2_data`, `redis_sentinel_data` (**declared but never mounted**), `minio_data`, `temporal_config` (**declared but never mounted**).

Notable topology facts:

- The API's `DATABASE_URL`/`DB_DIRECT_URL` point **directly at `postgres-halalgoes:5432`** — PgBouncer is deployed but **bypassed** by the API.
- `redis-master` has **no data volume** (only the conf file is mounted); AOF is enabled but data dies with the container. Replicas do have volumes.
- Sentinels monitor the master via **`${HOST_IP}` (the host's LAN IP)**, not the container name — a hybrid host-network HA design that requires `HOST_IP` to be set correctly; quorum is 2 with only 2 sentinels (no failover if one sentinel dies; 3 is the usual minimum).
- The Sentinel conf file at `config/redis/sentinel.conf` (down-after **5000**ms, monitor by hostname `redis-master`) is **never mounted** — compose generates its own conf inline (down-after **10000**ms, monitor by `${HOST_IP}`). Dead/conflicting config.

---

## 3. Prisma Data Model (`api/prisma/schema.prisma`, 834 lines, 27 models, 6 enums)

Generator: `prisma-client-js` with preview features `postgresqlExtensions`, `fullTextSearchPostgres`. Datasource uses `env("DATABASE_URL")` + `directUrl env("DB_DIRECT_URL")` (a pooler-aware setup, even though both are set to the same direct URL in compose).

Extensions declared in schema: `uuid-ossp`, `pg_trgm`, `unaccent`, `btree_gin`, `citext`, `bloom`, `fuzzystrmatch`, `plpgsql`, `postgis`, `postgis_tiger_geocoder`, `postgis_topology`.

### 3.1 Enums

| Enum | DB name | Values |
|---|---|---|
| OrderStatus | `order_status` | PENDING_PAYMENT, PLACED, CONFIRMED, PREPARING, RIDER_ASSIGNED, PICKED_UP, ON_THE_WAY, DELIVERED, DISPUTED, CANCELLED, REJECTED |
| DeliveryInstructions | `delivery_instructions` | DO_NOT_CALL, DO_NOT_RING_BELL, LEAVE_AT_DOOR |
| TransactionType | `transaction_type` | CREDIT, DEBIT, REFUND |
| PaymentStatus | `payment_status` | PENDING, PROCESSING, REJECTED, COMPLETED, CANCELLED, REFUND_REQUESTED, REFUND_COMPLETED |
| FoodItemVariantType | `food_item_variant_type` | SIZE, WEIGHT, QUANTITY |
| PaymentMethodType | **no @@map** (DB type `"PaymentMethodType"` — inconsistent with the snake_case mapping of every other enum) | CREDIT_CARD, DEBIT_CARD, ONLINE |

### 3.2 Models (all PKs are `uuid_generate_v4()` UUIDs; nearly all tables carry `created_at` default now + `last_modified_at @updatedAt`)

**User domain**
- `User` (`user`): first/last name (VarChar 50, nullable), email VarChar(320) (non-unique!), `email_verified`, `phone` VarChar(15) **unique**, `phone_verified`, `date_of_birth` Date. Soft-delete triple (`is_deleted`/`deleted_at`/`deleted_by`). Relations: saved_addresses, orders, cart, payment_methods, payment_history, food_reviews, rider_reviews, search_history, favorite_foods, favorite_restaurants. Hash indexes on phone, email, is_deleted.
- `UserFavoriteFood` (`user_favorite_food`), `UserFavoriteRestaurant` (`user_favorite_restaurant`): explicit M:N junctions, unique (user, target), cascade both sides.
- `UserSearchHistory` (`user_search_history`): query VarChar(255); BTree (user_id, created_at), **SpGist** on query, **Brin** on created_at.
- `DeliveryAddress` (`delivery_address`): name/street/building/floor/apartment/landmark/suburb/postal_code; third-person delivery fields (`is_third_person`, `third_person_name/phone`); `is_primary`; `location Unsupported("POINT")?` (native Postgres point, **not** PostGIS geometry) with Gist index; soft-delete; belongs to User (cascade).
- `UserPaymentMethod` (`user_payment_method`): just `payment_method PaymentMethodType` + soft-delete — a minimal stub (migration name literally `add_minimal_payment_method`). No card/token fields.

**Cart domain**
- `CartItems` (`cart_items`): per-user cart bound to a `delivery_address_id`, denormalized `delivery_location POINT?` + `delivery_postal_code`; `cart_value Money` default 0.0; junctions `cart_food_items`, `cart_coupons`.
- `CartFoodItems` (`cart_food_items`): quantity default 1, `selected_variant_id?` FK → FoodItemVariant, `selected_addon_ids UUID[]` (Gin) — addons stored as **unconstrained UUID array**, no FK. Unique (cart_id, food_item_id, selected_variant_id).
- `CartCoupons` (`cart_coupons`): junction cart↔coupon, unique pair, cascade.
- `CouponCode` (`coupon_code`): unique `name` VarChar(50), `description Citext?`, `discount_percent Decimal(5,2)` default 10.0, `expiry`, `created_by UUID` (no FK to Admin), soft-delete.
- `CheckoutLog` (`checkout_log`): `checkout_id` VarChar(100) unique, `current_step`, `steps_completed VarChar(50)[]`, `order_id UUID?` **without FK relation** — an orphan tracking table used by the checkout saga.

**Order/Payment domain**
- `Order` (`order`): status default PENDING_PAYMENT; `estimated_delivery_time Int?`; FKs to Restaurant, User(customer), DeliveryAddress, Rider? (delivery_partner). Money columns (`@db.Money`): delivery_partner_tip (0.00), item_total (0.00), **delivery_fee default 9.99**, **platform_fee default 4.99**, total_order_value (0.00), tov_after_discount (0.00). Timestamps: payment_confirmed_at, order_dispatched_at, order_delivered_at. `delivery_instructions DeliveryInstructions[]` (Gin), `coupon_codes VarChar(50)[]` (Gin — denormalized copy of coupon names, no FK). Indexes: (customer,status), (restaurant,status), (delivery_partner,status), Hash(status), Brin(created_at).
- `OrderFoodItems` (`order_food_items`): quantity + `unit_price Money` snapshot; unique (order_id, food_item_id) — **no variant/addon capture**, so cart variant/addon selections are lost at order time.
- `PaymentLog` (`payment_log`): amount Money, status default PENDING, `stripe_payment_id` unique nullable (**Stripe** is the intended PSP), payment_timestamp, transaction_type default CREDIT, actor(User), order? (nullable since migration 20250923045922), payment_method FK, `is_transaction_successful` default false.

**Rider domain**
- `Rider` (`rider`): names required, phone & email unique, `identity_docs Json[]` (Gin), `is_accepting_orders` default false, `total_earnings Money`, `total_orders_delivered Int`, `rating_avg Decimal(2,1)` (max 9.9), `location Unsupported("POINT")?` (Gist) **and** `coords Unsupported("geometry(Point,4326)")?` (Gist, added 2025-10-03) — two parallel geo columns. Soft-delete.
- `RiderRatingReview` (`rider_rating_review`): rating Decimal(2,1), review Citext, images String[] (Gin).

**Restaurant/Food domain**
- `Restaurant` (`restaurant`): halal-certification block: `is_halal_certified`, `halal_certification_docs Json[]` (Gin), `halal_certification_expiry Date?` (Brin), approval workflow: `approved_by_admin_id?` → Admin, `is_approved`, `approved_at`. `opening_time`/`closing_time` are `@db.Time()`. Moderation: `is_accepting_orders`, `is_banned`, `banned_reason Citext?`, `total_orders_processed`. Relations: address[], menu[], offers, orders, cuisines/categories junctions, favorite_users. Soft-delete. SpGist on name.
- `RestaurantAddress` (`restaurant_address`): street/suburb/city/country Char(2)/postal_code; `location POINT?` + `coords geometry(Point,4326)?` (same dual-geo pattern as Rider).
- `RestaurantMenu` (`restaurant_menu`): `is_active`, optional `activation_time`/`deactivation_time` (Time) for scheduled menus.
- `RestaurantCuisines` / `RestaurantCategories`: junctions with unique pairs, cascade.
- `RestaurantOffer` (`restaurant_offer`) and `FoodItemOffer` (`food_item_offer`) + junction `FoodItemOffers` (`food_item_offers`): offer_name, `offer_condition VarChar(200)[]` (Gin), offer_expiry Date?, offer_discount Int?.
- `FoodItem` (`food_item`): belongs to a menu; `is_currently_available`; item_name VarChar(150) (SpGist), `item_description Citext`, `item_images String[]`, `ingredients`/`allergens VarChar(50)[]` (Gin), `is_non_veg`, **`contains_diary`** (typo for "dairy") , `item_price Money`, `rating_avg Decimal(2,1)`; FKs **by name** to `Cuisine.name` and `FoodCategory.name` (natural-key FKs, VarChar 50); relations to variants, addons (via `FoodItemAddon` junction), reviews, offers, favorites, cart & order items. Soft-delete.
- `FoodItemVariant` (`food_item_variant`): variant_type enum, name/description, `variant_price Money`, `is_default_variant`, `is_currently_available`.
- `AddonItem` (`addon_item`) + `FoodItemAddon` junction.
- `FoodItemRatingReview` (`food_item_rating_review`): rating/review/images like rider reviews.
- `Cuisine` (`cuisine`), `FoodCategory` (`food_category`): unique names, referenced by name from FoodItem.

**Admin domain**
- `Admin` (`admin`): **only** id + timestamps + `restaurants_approved` relation. No credentials, email, role — admin identity/auth clearly lives elsewhere (better-auth) or is unfinished. Uses `last_modified` (not `last_modified_at` like every other model).

### 3.3 Indexing strategy (deliberate and unusually varied)

The schema uses nearly every PG index type: **Hash** (equality lookups: phone, email, status, FKs), **BTree** composites (e.g. `(customer_id, status)`), **Gin** (arrays & JSONB: images, ingredients, allergens, delivery_instructions, coupon_codes, identity_docs, halal docs), **SpGist** (text prefix search on names/queries), **Brin** (all `created_at`/expiry time columns), **Gist** (geo POINT/geometry). Several index map-names say `hash_idx` but are BTree (`rider_accepting_deleted_hash_idx`, `restaurant_approved_accepting_deleted_hash_idx`, `restaurant_menu_restaurant_active_hash_idx`) — naming drift.

### 3.4 Migrations (9, PostgreSQL provider, 2025-09-18 → 2025-10-03)

| Migration | Content |
|---|---|
| `20250918024459_init` (903 lines) | 11 CREATE EXTENSIONs, 5 enums, all tables/indexes/FKs. `location` columns initially NOT NULL native `POINT`. |
| `20250920235702_model_updates` | rider phone/email_verified defaults false |
| `20250920235940_location_unsupported_nullable` | all 4 location columns → nullable |
| `20250922220438_updates_cart_models` | drops implicit `_CartItemsToCouponCode`, creates `cart_coupons`, adds `selected_variant_id`/`selected_addon_ids` to cart_food_items, new unique incl. variant |
| `20250923045922_order_is_nullable_on_payment_log` | payment_log.order_id nullable, FK ON DELETE SET NULL |
| `20250923051810_add_minimal_payment_method` | creates `PaymentMethodType` enum + required column (with data-loss warning comment) |
| `20250924034918_add_defaults_to_tov_n_after_discount` | defaults 0.00 on total_order_value/tov_after_discount |
| `20250928015107_add_checkout_log_model` | checkout_log table |
| `20251003040837_add_coords_fields_on_rider_restaurant` | adds PostGIS `coords geometry(Point,4326)` + GIST idx on rider & restaurant_address |

### 3.5 Seed (`api/prisma/seed.ts`, 325 lines)

Creates: 1 empty Admin, 4 cuisines (indian/chinese/italian/mexican), 4 categories (appetizers/main_course/desserts/beverages), 2 users (+91 phones, John Doe/Jane Smith), 2 addresses (Hyderabad postal codes 500001/500016), 2 payment methods (CREDIT_CARD/DEBIT_CARD), 2 riders (Mike Wilson, Sarah Johnson — only Sarah accepting orders), 2 restaurants (Spice Paradise, Pizza Italia; opening times seeded on epoch date `2000-01-01Txx:00`), 2 restaurant addresses (Hyderabad, country `IN`), cuisine/category links, 2 active menus, 3 food items (Chicken Biryani 12.99, Margherita Pizza 10.99, Paneer Tikka 8.99 — uses the `contains_diary` typo field), 2 addons (Extra Cheese 2.50, Garlic Bread 3.99), 2 coupons (WELCOME10 10% exp 2026-12-31, SUMMER25 25% exp 2026-08-31). Seeding is manual (`pnpm run prisma:seed` / `prisma db seed`), never automatic (per `prisma/README.md`).

---

## 4. Redis Configuration (`config/redis/`)

- `master/redis.conf` (8 lines): `bind 0.0.0.0`, **`protected-mode no`**, port 6379, `appendonly yes`, `appendfsync everysec`, RDB saves `900 1` / `300 10` / `60 10000`. **No `requirepass`** — an open Redis, additionally published on the host port.
- `sentinel.conf` (8 lines): bind 0.0.0.0, protected-mode no, port 26379, `dir /tmp`, monitor `mymaster redis-master 6379` quorum 2, down-after **5000ms**, failover-timeout 10000, parallel-syncs 1. **Unused by compose** (inline conf used instead, with different down-after and `${HOST_IP}` target).
- Compose passes `REDIS_KEYSPACE_NOTIFICATIONS: Ex` to the API — the app enables keyspace-expiry events (`Ex`) itself; the redis.conf does not set `notify-keyspace-events` (relies on the client issuing CONFIG SET, per the API's Redis service).

---

## 5. Custom DB Images (`db-images/`) — **entirely dead/unwired code**

Neither image is referenced by `docker-compose.yml` (which uses stock `postgis/postgis:17-3.6-alpine` and `edoburu/pgbouncer`). This directory is an abandoned/aspirational build set with multiple defects:

### 5.1 `db-images/pg/`
- `Dockerfile`: two conflicting halves concatenated. Part 1: `FROM postgis/postgis:15-3.4`, installs `postgresql-15-cron` (pgrouting/partman/pg_stat_statements commented out), **malformed `RUN apt-get clean \` followed by `RUN rm -rf ...`** (broken line continuation), copies init scripts, appends `shared_preload_libraries = 'pg_stat_statements,pg_cron'`. Part 2 (after a `# ====` divider): a multi-stage build compiling **supabase `pg_net`** from source — but installs `postgresql-server-dev-16` against a PG15 base and copies artifacts from `/usr/lib/postgresql/16/`; references `01-init_extensions.sql` (file is actually named `01-enable-extensions.sql`); entrypoint `custom-entrypoint.sh` is never COPYd; final CMD sets `shared_preload_libraries=pg_net` and `log_statement=all`.
- `entrypoint.sh`: generates `02-configure-pg-net.sh` at container init to `ALTER SYSTEM SET pg_net.ttl='1hour'`, `pg_net.database_name`, `pg_net.username`, then chains to the stock entrypoint.
- `01-enable-extensions.sql`: **has a `#!/bin/bash` shebang inside a .sql file** plus a stray `COMMIT;` with no BEGIN; enables uuid-ossp, postgis, pg_trgm, unaccent, btree_gin, pg_cron, pg_stat_statements.
- `postgresql.conf`: "HalalGoes Production" tuning — max_connections 100, shared_buffers 256MB, effective_cache_size 1GB, work_mem 4MB, maintenance_work_mem 64MB, checkpoint_completion_target 0.9, max_wal_size 1GB, random_page_cost 1.1 (SSD), autovacuum on/1min, **password_encryption = scram-sha-256**, wal_level replica, wal_compression on, connection/lock logging on. Not mounted anywhere.

### 5.2 `db-images/pgbouncer/`
- `Dockerfile`: builds PgBouncer **1.24.1** from source on alpine 3.21, runs as `postgres` user, LABEL maintainer "Websleak".
- `entrypoint.sh` (556 lines): elaborate generator that parses `DATABASE_URL`/`DATABASE_URLS` (comma-separated), writes `userlist.txt` (md5 = `md5(password+username)`, or plain for scram), and emits a full `pgbouncer.ini` from ~60 env vars (LISTEN_ADDR, POOL_MODE, MAX_CLIENT_CONN, TLS files, TCP keepalive tuning, etc.). Defaults: transaction pooling, 100 clients, pool 20/min 5/reserve 5.
- `pgbouncer.ini` (static sample): wildcard db → `host=postgres port=5432 dbname=postgres auth_user=postgres`, listen 5432, **auth_type md5** (conflicts with postgresql.conf's scram-sha-256), pool_mode transaction, max_client_conn 100, server_reset_query DISCARD ALL, client_tls disable / server_tls prefer, query_wait_timeout 120.
- `userlist.txt`: **committed credential material** — `"hg_user" "md508d195fe94487d5f5d2e3201d43b273a"` (md5 of password+username, crackable offline; gen-userlist.sh even chmods it 600 yet it's in git).

### 5.3 `gen-userlist.sh` (repo root, 104 lines)
Bash helper: loads `.env`, requires `HG_DB_USER`/`HG_DB_PASS` (warns if `HG_DB` missing), computes `md5${md5(pass+user)}`, writes `db-images/pgbouncer/userlist.txt`, chmod 600, prints redacted preview. Uses `stat -f%z || stat -c%s` for macOS/Linux portability. Points at `auth_file = /etc/pgbouncer/userlist.txt`.

---

## 6. Temporal (`temporal/`)

- `docker.yaml`: **empty file** (would be the dynamic-config override for the dockerized server; the compose stack doesn't mount any dynamic config nor the `temporal_config` volume).
- `development-sql.yaml`: `limit.maxIDLength: 255`, `system.forceSearchAttributesCacheRefreshOnRead: true` ("Dev setup only. Please don't turn this on in production.").
- `development-cass.yaml`: only the cache-refresh flag.
- `README.md`: explains the dynamic-config format (constraints: namespace / taskQueueName / taskType 1=Workflow 2=Activity).
- Server: `temporalio/auto-setup:latest` persists to the **same application Postgres** (`DB: postgres12`, `POSTGRES_SEEDS: postgres`) — Temporal creates its own `temporal`/`temporal_visibility` DBs alongside `halalgoes_db`. UI on :8080, gRPC on :7233, namespace from `TEMPORAL_NAMESPACE` (default `default`).

**Task queues used by the API workers/clients** (from `api/src`, for integration context): `users-queue`, `cart-queue`, `orders-queue`, `riders-queue`, `restaurants-queue`, `checkouts-queue`, `payments-queue`, `notifications-queue`.

---

## 7. API Build, Test & Release Tooling (`api/`)

### 7.1 `package.json` (`@hg/api` v**1.2.26**, private, UNLICENSED)
- Scripts: nest build/start variants, jest unit (`rootDir: src`, `.*\.spec\.ts$`, ts-jest, node env) + `test:e2e` (separate `test/jest-e2e.json`), `prisma:migrate` = `prisma migrate deploy`, `prisma:seed` = `ts-node prisma/seed.ts` (also wired via the `prisma.seed` key), `release`/`release:patch|minor|major` via release-it.
- Runtime deps of note: NestJS 11 (express + socket.io + ws platforms), Prisma client 6.16.1, `@temporalio/{client,worker,workflow,activity}` 1.13, `nestjs-temporal` 2.0.1, ioredis 5.7 + keyv/@keyv/redis + cache-manager 7 + cacheable, **better-auth 1.3.13** (auth), minio 8.0.6, zod 4 + nestjs-zod + @anatine/zod-nestjs/openapi, `@scalar/nestjs-api-reference` (docs UI), nestjs-pino/pino-http, nanoid, uuidv7, ms, socket.io 4.8, ws 8.18.
- Dev deps: prisma CLI 6.16.1, eslint 9 + typescript-eslint 8, jest 30, ts-jest 29, release-it 19 + conventional-changelog, supertest 7, TS 5.7.

### 7.2 `tsconfig.json` / `tsconfig.build.json` / `nest-cli.json`
- module/moduleResolution `nodenext`, target ES2023, decorators on, sourceMap, incremental, outDir `./dist`; **loose typing**: `noImplicitAny: false`, `strictBindCallApply: false`, only `strictNullChecks: true`. Build config excludes test/spec. Nest CLI: standard schematics, sourceRoot `src`, `deleteOutDir`.

### 7.3 API `Dockerfile` (multi-stage, node:20-slim Debian — comment: "not Alpine — Temporal requires glibc")
Stages: base (openssl + ca-certificates, pnpm global) → dependencies (`pnpm install --frozen-lockfile`) → build (`prisma generate`, `pnpm run build`) → production (`--prod` install, `pnpm add -D prisma` for CLI, `prisma generate`, copy dist). Generates `/app/start.sh`: **`npx prisma migrate deploy` then `node dist/src/main`** — migrations run automatically on every container boot. Non-root user `nestjs` (uid 1001, group nodejs 1001). EXPOSE 3456 9080. HEALTHCHECK curls `http://localhost:3456/health` (30s/10s/40s/3). `.dockerignore` excludes tests, docs, envs (keeps `.env.example`), CI files.

### 7.4 Test setup
- `test/jest-e2e.json` + `test/app.e2e-spec.ts`: default Nest scaffold expecting `GET /` → 200 "Hello World!" — almost certainly stale against the real app.
- `api/test-simple.js`: ad-hoc WebSocket notification test: connects `ws://localhost:9080`, sends `{event:'connect_user', userId:'b5bdc9cc-013f-4729-a598-b95801d3b47d', userType:'user'}`, waits for `connection_confirmed`, POSTs `http://localhost:3000/notifications/send` (**port 3000, not 3456** — stale), expects a `notification` event within 3s. Documents the WS protocol events: `connect_user`, `connection_confirmed`, `notification`.
- `eslintrc.js` (note: no leading dot, so likely not picked up; eslint 9 in deps expects flat config): legacy config with typo rule **`'pretter/prettier': 'off'`**.
- `.prettierrc`: singleQuote + trailingComma all.

### 7.5 Release pipeline (`.release-it.json`, `RELEASE.md`, `CHANGELOG.md`)
- release-it with conventional-changelog (whatBump null → manual bump choice), git commit `chore(release): v${version}`, tag `v${version}`, push; no GitHub release, no npm publish. Hooks: after bump → `docker build -t halalgoes-api:${version} -t halalgoes-api:latest`; after git release → tag & push to Docker Hub as `$DOCKER_USERNAME/halalgoes-api:{version,latest}`.
- CHANGELOG confirms repo `github.com/shaiknoorullah/hg-api`, latest v1.2.26 (2025-10-11) "fixes checkouts worker not being registered".
- Root `package.json` (repo root, not api/): stray 3-dependency file (`@nestjs/event-emitter`, `nestjs-pino`, `pino-http`) — almost certainly accidental.

---

## 8. Configuration & Environment Variables (from `.env.example` + compose)

**Required (no defaults):** `HG_DB_PASS`, `PGADMIN_PASS`, `MINIO_ROOT_PASSWORD` (min 8 chars), `HOST_IP` (machine LAN IP for Redis replica/sentinel announcement; "not localhost").

**Optional with defaults:** `HG_DB=halalgoes_db`, `HG_DB_USER=postgres`, `POSTGRES_PORT=5432`, `PGADMIN_EMAIL=admin@example.com`, `PGADMIN_PORT=5050`, `PGBOUNCER_PORT=6432` + 9 PGBOUNCER_* tuning vars (see §2 table), `REDIS_MASTER_PORT=6379`, `REDIS_SENTINEL_1_PORT=26379`, `REDIS_SENTINEL_2_PORT=26380`, `MINIO_ROOT_USER=admin`, `MINIO_BROWSER=on`, `MINIO_REGION=us-east-1`, `MINIO_API_PORT=9000`, `MINIO_CONSOLE_PORT=9001`, `TEMPORAL_PORT=7233`, `TEMPORAL_UI_PORT=8080`, `TEMPORAL_NAMESPACE=default`, `API_PORT=3456`, `WS_PORT=9080`.

**Injected into the API container:** `NODE_ENV=production`, `PORT`, `DATABASE_URL` & `DB_DIRECT_URL` (both direct-to-postgres, `?schema=public`), `REDIS_HOST=redis-master`, `REDIS_PORT=6379`, `REDIS_DB=0`, `REDIS_KEYSPACE_NOTIFICATIONS=Ex`, `TEMPORAL_ADDRESS=temporal:7233`, `TEMPORAL_NAMESPACE`, `MINIO_ACCESS_KEY=${MINIO_ROOT_USER}`, `MINIO_ACCESS_SECRET=${MINIO_ROOT_PASSWORD}` (the API uses the MinIO **root** credentials). App code additionally references (commented in `app.module.ts`) `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_SECRET_KEY`.

---

## 9. Auth/Security Model Touching This Area

- DB auth: single superuser (`postgres` by default) shared by app, PgBouncer, pgAdmin and Temporal; md5 auth at PgBouncer vs scram config in the (unused) postgresql.conf.
- Redis: `protected-mode no`, no password, port published to host — fully open on the LAN; Sentinels equally unauthenticated.
- MinIO: API uses root credentials rather than a scoped access key.
- pgAdmin: `PGADMIN_CONFIG_ENHANCED_COOKIE_PROTECTION=False`.
- `db-images/pgbouncer/userlist.txt` commits an md5 password-derived hash for `hg_user` to VCS.
- Schema has soft-delete + `deleted_by` audit columns across user/rider/restaurant/food/coupon/address/payment-method; `Admin` model carries no credentials (auth handled by better-auth in the API layer, outside this scope).
- API container runs as non-root; prisma migrate runs with full DDL rights on boot (necessary but noteworthy).

---

## 10. Code-Quality Observations (dead code, bugs, inconsistencies)

1. **PgBouncer deployed but bypassed** — API `DATABASE_URL` targets `postgres-halalgoes:5432` directly; the whole pooling tier (and the `directUrl` distinction in schema.prisma) is inert.
2. **`db-images/` is entirely dead**: neither custom pg nor pgbouncer image is used by compose; the pg Dockerfile is unbuildable (PG15 base vs PG16 dev headers/paths, malformed RUN continuation, missing `custom-entrypoint.sh`, wrong init-sql filename); `01-enable-extensions.sql` has a bash shebang inside SQL.
3. **Redis master has no data volume**; AOF/RDB persist only inside the container FS. `redis_sentinel_data` and `temporal_config` volumes declared but never mounted.
4. **Sentinel config duplication/drift**: `config/redis/sentinel.conf` (unused, down-after 5s, monitors by hostname) vs compose inline conf (down-after 10s, monitors `${HOST_IP}`). Only 2 sentinels with quorum 2 → no automatic failover if one sentinel is down. sentinel-1 lacks a healthcheck; sentinel-2's healthcheck pings port 26380 *inside* the container where sentinel listens on 26379 (likely always failing).
5. **Open Redis** (`protected-mode no`, no auth, host-published) and passwordless replica announcement to `${HOST_IP}`.
6. Schema typo **`contains_diary`** (dairy) on FoodItem — baked into migrations and seed.
7. **Order line items don't record variants/addons** (unique on order+food only), though carts do — selection fidelity is lost between cart and order; `Order.coupon_codes` is a denormalized string array with no FK.
8. `CheckoutLog.order_id` has no FK; `CouponCode.created_by` has no FK to Admin.
9. `PaymentMethodType` enum lacks `@@map` (PascalCase type name in DB, inconsistent with all other enums); `UserPaymentMethod` stores no actual payment instrument data.
10. `User.email` is non-unique (only phone is unique) — intentional for phone-first auth but worth flagging.
11. Dual geo columns (`location` native POINT vs `coords` PostGIS geometry 4326) on Rider and RestaurantAddress; DeliveryAddress/CartItems still only have native POINT — inconsistent geospatial strategy mid-migration.
12. `@db.Money` used for all currency (locale-formatted, awkward with Prisma Decimal); `rating_avg Decimal(2,1)`.
13. Misleading index map names (`*_hash_idx` on BTree indexes, §3.3).
14. Hardcoded fee defaults in schema: delivery_fee **9.99**, platform_fee **4.99**.
15. eslint config broken twice: filename `eslintrc.js` (no dot) + legacy format under eslint 9 + typo `'pretter/prettier'`.
16. Stale tests: e2e expects scaffold "Hello World!"; `test-simple.js` posts to port 3000 while the API listens on 3456; contains a hardcoded test user UUID.
17. `temporal/docker.yaml` is empty and no dynamic config is mounted; dev-only flag `forceSearchAttributesCacheRefreshOnRead: true` in the sql/cass yamls with an explicit "don't use in production" comment.
18. `:latest` image tags for redis, pgadmin, temporal, temporal-ui, temporal-admin-tools, redisinsight — non-reproducible deploys (Postgres, MinIO and PgBouncer are pinned).
19. Root-level `package.json` with 3 stray deps duplicated from api/ — likely accidental.
20. Temporal shares the application Postgres instance — resource coupling between workflow-engine persistence and OLTP data.
21. Compose `POSTGRES_INITDB_ARGS` sets `--lc-collate=C --lc-ctype=C` while the dead custom image sets en_US.UTF-8 — another drift point.
22. Prisma init migration creates 11 extensions incl. tiger geocoder/topology — heavyweight for what the schema actually uses.

---

## 11. Integration Points Summary

- **Postgres** `postgres-halalgoes:5432` / host `:5432`; db `halalgoes_db`; consumed by API (Prisma), Temporal server, pgAdmin, PgBouncer (`:6432`, unused by API).
- **Redis** master `redis-master:6379` (API via `REDIS_HOST`/`REDIS_PORT`/`REDIS_DB=0`, keyspace-notify `Ex` for TTL-based flows); replicas announce via `HOST_IP:6380/6381`; sentinels `:26379/:26380` monitor `mymaster`.
- **Temporal** gRPC `temporal:7233`, namespace `default`; task queues `users-queue`, `cart-queue`, `orders-queue`, `riders-queue`, `restaurants-queue`, `checkouts-queue`, `payments-queue`, `notifications-queue`; UI `:8080`.
- **MinIO** S3 API `:9000`, console `:9001`; API authenticates with root creds (`MINIO_ACCESS_KEY`/`MINIO_ACCESS_SECRET`).
- **API** HTTP `:3456` (Swagger/Scalar docs at `/api/docs`, health at `/health`), raw WebSocket gateway `:9080` (events `connect_user` / `connection_confirmed` / `notification`).
- **Stripe** referenced via `PaymentLog.stripe_payment_id`.
- Sibling repo `hg-docker` replicates the Redis master/sentinel topology for external environments; frontends consume the API over HTTP/WS.
