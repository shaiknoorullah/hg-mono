# Gap Analysis: Committed MinIO Runtime State, Temporal & Redis Config

Repo: `/home/user/hg-api` (remote `https://github.com/shaiknoorullah/hg-api`, files present in HEAD commit `86c52a7 feat(@hg/api): update all endpoints`)
Date: 2026-08-09

---

## 1. MinIO `.minio.sys` runtime state — LEAKS PLAINTEXT CREDENTIALS

### Inventory
`git ls-files minio | wc -l` = **23 tracked files**. Full list of `minio/.minio.sys` (path — size bytes):

```
format.json                                                                   232
pool.bin/xl.meta                                                              479
config/config.json/xl.meta                                                   9811
config/iam/format.json/xl.meta                                                434
config/iam/policydb/users/rider_access_user.json/xl.meta                      500
config/iam/service-accounts/FXTv0HIZNKBBNljSSHMv/identity.json/xl.meta       1327
config/iam/service-accounts/YxG6r7lqPXEH0vpvU6pp/identity.json/xl.meta        978
config/iam/users/rider_access_user/identity.json/xl.meta                      606
buckets/.bloomcycle.bin/xl.meta                                              743
buckets/.heal/mrf/list.bin                                                     4
buckets/.usage-cache.bin/xl.meta                                             604
buckets/.usage-cache.bin.bkp/xl.meta                                         604
buckets/.usage.json/xl.meta                                                 1488
buckets/riders/.metadata.bin/xl.meta                                        2114
buckets/riders/.usage-cache.bin/xl.meta                                      575
buckets/riders/.usage-cache.bin.bkp/xl.meta                                  575
tmp/461c9ccb-29ec-4f78-802a-a2cdf1f09320                                    2049
tmp/.trash/<6 uuid dirs>/xl.meta.bkp                                        ~575-1488
```

`format.json`: `xl-single` deployment, id `2a1270ca-…`. This is a real single-node MinIO backend directory captured live.

### Credential material — stored in CLEARTEXT (not encrypted)
The IAM `identity.json` objects are stored as MinIO `xl.meta` files with `x-minio-internal-inline-data: true`; the inline data is **plaintext JSON**, readable with `strings`. There is **no KMS/KES envelope** — `config.json` `identity_*`, `kms`, and top-level `credentials._` are all empty/`null`, and no `MINIO_KMS_*` encryption markers exist. MinIO only encrypts IAM data when a KES/KMS secret is configured; here it was not, so secrets are on disk (and in git) in the clear.

Extracted (redacted to prefixes):

| Principal | accessKey | secretKey | notes |
|---|---|---|---|
| IAM user `rider_access_user` | `rider_access_user` | `rider1…` (weak, 8-char) | policy `readwrite`, status `on`, created 2025-09-21 |
| Service account | `FXTv0HIZNK…` | `qUuOl7No5m…` (40-char) | parentUser **`admin@halalgoes.com`**, name `minio_rider_access`, expiration 2025-12-31, + full JWT `sessionToken` (`eyJhbGci…`) |
| Service account | `YxG6r7lqPX…` | `9hS1sLQ3Zj…` (40-char) | parentUser `rider_access_user`, name `rides_read_write_access`, expiration 2025-11-30, + JWT `sessionToken` |

Decoded embedded session policy of the `FXTv0HIZNK…` service account (base64 in its JWT):
```json
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["admin:*"]},
  {"Effect":"Allow","Action":["kms:*"]},
  {"Effect":"Allow","Action":["s3:*"],"Resource":["arn:aws:s3:::*"]}]}
```
i.e. that credential (child of the **root** `admin@halalgoes.com`) carries effectively full MinIO admin + all-bucket S3 + KMS.

The MinIO **root password itself is NOT in the dump** (comes from `MINIO_ROOT_PASSWORD` env at runtime; `config.json` credentials block is null). But that is little comfort: the leaked service-account access/secret key pairs are **directly usable S3 credentials** and one of them is admin-scoped under the root parent.

### Bucket state (see §2 for the verdict)
`buckets/` contains only MinIO system pseudo-buckets (`.bloomcycle.bin`, `.usage-cache.bin`, `.usage.json`, `.heal`) plus **one real bucket: `riders`**. The `riders/.metadata.bin` proves its config:

- **PUBLIC bucket policy** — `Principal: {"AWS":["*"]}` grants anonymous `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`, multipart on `arn:aws:s3:::riders/*`. World-readable **and** world-writable.
- Tags: `userType=rider`, `objects=identity-documents`.
- Object Lock: `COMPLIANCE`, 90 days; Versioning: `Enabled`; Quota: 20 GiB hard.

### Security impact (committed + pushed to GitHub)
- **Directly usable secret keys** for two MinIO service accounts (one admin-scoped under root `admin@halalgoes.com`) and one weak IAM user password (`rider1…`) are in git history and on the remote. Anyone with repo read access (and anyone who ever had it — rotation via `git rm` is insufficient, history retains them) can authenticate to the MinIO instance if reachable.
- The `riders` bucket that holds **rider identity documents** was configured with an anonymous read/write/delete policy — a data-exposure and tampering exposure independent of the leaked keys. Object-Lock COMPLIANCE mitigates deletion of existing versions but not reading or writing new objects.
- The `admin@halalgoes.com` root identity is disclosed; session-policy JWTs are present (expirations in late 2025, so likely expired *now* on 2026-08-09, but the underlying long-lived secretKeys do not expire).
- Recommended: treat all three key pairs and the root password as compromised and rotate; purge git history; make `riders` private; enable KES/KMS; add `minio/` to `.gitignore`.

---

## 2. How it got here + real bucket-name verdict

### Not a compose bind-mount — orphaned committed state
Neither compose file bind-mounts `./minio`. Both `/home/user/hg-api/docker-compose.yml` and `/home/user/hg-docker/docker-compose.yml` declare the MinIO service (`minio/minio:RELEASE.2025-04-22T22-12-26Z`) with a **named volume** `minio_data:/data` — no `./minio:/data` and no `./data`. So the committed `minio/.minio.sys` did not originate from these compose definitions; it is captured runtime state from some earlier/manual run (e.g. a prior host bind-mount or `docker cp`) that was accidentally committed.

`.gitignore` (`/home/user/hg-api/.gitignore`) is the stock Node template and does **not** list `minio/`, `.minio.sys`, `temporal/`, or `config/redis/`. Nothing was set up to ignore this directory, which is why it was committed.

MinIO env (`hg-docker/.env.example`, `hg-api/.env.example`): `MINIO_ROOT_USER=admin`, `MINIO_ROOT_PASSWORD=your_minio_password_here` (placeholder) — consistent with the `admin@halalgoes.com` root parent seen in the IAM dump.

### Bucket names: code/docs vs runtime reality
- **Runtime state proves exactly one application bucket was ever created: `riders`.** No `profile-pictures`, `restaurant-images`, `food-images`, or `restaurant-documents` bucket exists anywhere in `.minio.sys`. Those names (cited by other reports/docs) were **never created on this stack**.
- **API source (`/home/user/hg-api/api/src`) contains NO bucket name and NO presigned-URL / bucket-creation code.** `core/files/files.service.ts` merely subclasses the `minio` `Client`; `core/files/files.module.ts` wires options; the MinIO factory in `app.module.ts` (lines 72–76) is **commented out**. Grepping the whole `api/src` for `presignedPutObject|makeBucket|bucketName|'riders'|profile-pictures|…` yields nothing but the unrelated `@Controller('riders')` / `@Get('riders')` HTTP routes. So the checked-in source did not create the `riders` bucket — the **deployed image** (`devsupreme0/halalgoes-api:${API_VERSION}`, referenced in `hg-docker/docker-compose.yml`) did.
- **Frontend upload flows (`/home/user/halal-goes`):**
  - Rider app new flow (`apps/rider/lib/apis/rider/onboarding/documents`, `components/DocumentUploadScreen.tsx`, `app/rider-verification.tsx`): calls backend `getDocumentUploadUrl(...)` → receives `upload_url` + `objectKey`, then `uploadFileToPresignedUrl(uploadUrl, …)`. This **presigned-URL flow is what populated the `riders` bucket** (bucket tagged `objects=identity-documents`, i.e. rider identity docs). The runtime state confirms this is the document-upload path that actually ran against this stack.
  - Rider app legacy flow (`apps/rider/services/payloadFormService.ts`): uses a Supabase-style `.from(bucketName)` client with `bucketName = 'hg-bucket'` — a **different (Supabase) storage backend**, not MinIO, and not present in `.minio.sys`.

**Verdict:** The only bucket that truly exists is `riders` (holding rider identity documents, publicly read/write). The other bucket names are documentation/aspiration, not runtime fact. The rider-onboarding presigned-URL upload flow is the one confirmed to have exercised this MinIO stack.

---

## 3. Temporal config — stock templates, unmounted/dead

Files under `/home/user/hg-api/temporal`:
- `README.md` — the **verbatim upstream Temporal `config/dynamicconfig` README** (explains `docker.yaml` override, the three constraint types, sample format). No project-specific content.
- `development-sql.yaml` — stock dev dynamic config: `limit.maxIDLength: 255`, `system.forceSearchAttributesCacheRefreshOnRead: true` (with the standard "Dev setup only" comment).
- `development-cass.yaml` — stock dev dynamic config: only `system.forceSearchAttributesCacheRefreshOnRead: true`.
- `docker.yaml` — **0 bytes (empty)**.

No `halalgoes`, custom namespace, or custom dynamic-config keys anywhere — these are unmodified Template/Temporal defaults.

**Mounting:** Neither `docker-compose.yml` mounts `./temporal`. The `temporal` service uses `temporalio/auto-setup:latest` with `DB/POSTGRES_*` env and **no volumes**; `TEMPORAL_NAMESPACE` defaults to `default`. So all four files are **dead/unused** in the repo — nothing reads them. (Namespace `default` is used by the API via `TEMPORAL_NAMESPACE:-default`.)

---

## 4. Redis config — no auth; hg-docker mount path is broken

### hg-api `config/redis/master/redis.conf`
```
bind 0.0.0.0
protected-mode no
port 6379
appendonly yes
appendfsync everysec
save 900 1 / 300 10 / 60 10000
```
### hg-api `config/redis/sentinel.conf`
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
`/home/user/hg-docker/redis/master/redis.conf` and `redis/sentinel.conf` are **byte-identical** to the hg-api copies (verified with `diff`).

### Directives that matter
- **`requirepass` ABSENT** — Redis master has **no authentication**. Combined with `bind 0.0.0.0` + `protected-mode no`, any host that can reach the port has full access. `masterauth` also absent (replicas need none since master needs none).
- `appendonly yes` + `appendfsync everysec` + RDB `save` — durability on.
- **`notify-keyspace-events` ABSENT** from `redis.conf`, yet both compose files pass the API `REDIS_KEYSPACE_NOTIFICATIONS: Ex`. Keyspace notifications are therefore **not enabled at the server level via the conf** — they'd have to be turned on at runtime (`CONFIG SET`) or the app relies solely on the env hint. Expiry-event-driven logic risks silently not firing.
- Sentinel: `protected-mode no`, no auth, `dir /tmp`.

### Mount-path reconciliation (per repo)
Both compose files declare the master mount identically:
```
- ./config/redis/master/redis.conf:/usr/local/etc/redis/redis.conf
```
- **hg-api: RESOLVES.** The file exists at `hg-api/config/redis/master/redis.conf`. The bind mount is correct; redis-master starts with this conf.
- **hg-docker: BROKEN.** hg-docker has the file at `redis/master/redis.conf` (there is **no `config/` directory**). The source path `./config/redis/master/redis.conf` does not exist, so Docker **creates an empty directory** at that path and mounts a *directory* over the container's `redis.conf` file. `redis-server /usr/local/etc/redis/redis.conf` then fails to load a valid config (path is a dir) — redis-master is effectively misconfigured / starts without the intended settings in hg-docker.

### Sentinel conf — unmounted in both repos
Neither compose mounts `sentinel.conf`. The `redis-sentinel-1/2` services build their config inline via `sh -c 'echo "bind 0.0.0.0" > /etc/sentinel.conf && … redis-sentinel /etc/sentinel.conf'` (using `${HOST_IP}` and `down-after-milliseconds 10000`, vs the file's `5000`). So the committed `sentinel.conf` files are **dead/unused** in both repos, and the effective sentinel settings differ from the file.

---

## Summary of dead vs live config
| Artifact | In repo | Mounted/used? |
|---|---|---|
| `minio/.minio.sys` | hg-api | Not mounted (named volume `minio_data`); orphaned committed live state — leaks creds |
| `temporal/*.yaml`, README | hg-api | Not mounted; auto-setup image; dead |
| `config/redis/master/redis.conf` | hg-api | Mounted & resolves (hg-api); path broken in hg-docker |
| `redis/sentinel.conf` / `config/redis/sentinel.conf` | both | Not mounted; sentinels use inline echo; dead |
