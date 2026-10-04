# The HalalGoes server, as code

Ansible that turns a fresh Contabo Cloud VPS 6 (Debian 13 or Ubuntu 24.04 LTS) into the HalalGoes production server, and keeps it that way. One server at launch, as the owner decided on 4 Oct 2026 ([#207][i207-oneserver]). The warm standby ([#210][i210]) is added next month by one more playbook, without rebuilding this one.

Everything here is open source and self-hosted. The only outside services it talks to are Resend (alert email), and the providers the app already uses.

| File | What it is |
|---|---|
| `provision.sh` | **The one command.** First run and every run after |
| `site.yml` | Everything on the production server, in order. Safe to run again at any time |
| `bootstrap.yml` | First contact as root: creates the `ops` account, nothing else |
| `offline.yml` | The owner's always-on machine: the off-server backup copy and the outside watcher |
| `standby.yml` | Next month: the warm standby. Never applied by `site.yml` |
| `group_vars/all.yml` | Every shared setting, and every container image pinned by tag and digest (from public registries for now: the [object-storage decision](../../docs/decisions/README.md#settled--platform-decisions-owner-2026-10-01) asks for Silo in a registry HalalGoes controls, an open question in [#278][pr278]) |
| `inventory/hosts.example.yml` | The inventory's shape; `provision.sh` writes the real one (kept local) |
| `secrets/*.example.*` | The shape of each encrypted secrets file. Never filled in |
| `tests/check.sh` | Syntax, ansible-lint and shellcheck; needs no server |

## Day 1, in order

**What the owner gives:**

1. The server's public IPv4 address, from Contabo's delivery email.
2. Root access: the SSH key added when ordering (preferred), or the root password.
3. The laptop's WireGuard public key (`wg pubkey < private.key`, or from the WireGuard app).
4. The address alerts should go to.

**On the owner's laptop**, once: install `ansible-core` 2.19 or later, `sops` 3.9 or later, `age` and `openssl` (and `sshpass` only for a root password). Then, from a checkout of this repository:

```bash
cd deploy/host
./provision.sh 203.0.113.10 --laptop-key 'AbC...=' --email owner@example.com   # add --root-password if Contabo gave a password
```

It creates your age key and the encrypted secrets the first time (it says which passwords to copy into the offline password manager), writes `inventory/hosts.yml`, creates the `ops` account, and sets up everything in `site.yml` over the public address. SSH stays reachable there, keys only, until your tunnel works. Then:

1. Open `out/owner-laptop.conf`, replace the `PrivateKey` line with your laptop's private key, and bring it up: `sudo wg-quick up ./out/owner-laptop.conf`, or import it into the WireGuard app.
2. Run `./provision.sh` again. It now connects over WireGuard and closes public SSH. It only closes it on a run that itself came through the tunnel, so it can't lock you out.
3. Add the keys you have: the Resend API key for alerts (`sops edit ~/.config/halalgoes/secrets/host.sops.yaml`, `hg_alert_smtp_password`), and the dev environment's test-mode keys (`sops edit ~/.config/halalgoes/secrets/dev.sops.env`). Run `./provision.sh` again.
4. Take the first Contabo snapshot in the panel.

**What to check** (over WireGuard: `ssh ops@10.66.0.1`):

| Check | Expect |
|---|---|
| `ssh ops@<public IP>` from anywhere | refused |
| `sudo sshd -T \| grep -E 'permitrootlogin\|passwordauthentication'` | both `no` |
| `nmap -Pn -p- <public IPv4>` and the IPv6 address, from outside | only 80 and 443 (WireGuard answers no scan) |
| `sudo docker run --rm -d --name stray -p 8099:80 nginx:alpine`, then `curl -m 5 http://<public IP>:8099` from outside, then `sudo docker stop stray` | the curl times out: the DOCKER-USER guard drops stray published ports |
| `sudo nft list table inet host` and `sudo iptables -S DOCKER-USER` | the rules in `roles/firewall` and `roles/docker` |
| `systemctl list-timers 'hg-*'` | backups, metrics, the monthly drill, the reboot window, image clean-up |
| `sudo docker version --format '{{.Server.Version}}'` | 29.x: Engine 28 or later, held on major version 29 by `/etc/apt/preferences.d/docker` |
| `sudo ls -ln /srv/hg/secrets`, once `prod.sops.env` exists | four files, each `-r--------`, owned by 0 except `redis_password` (999) |
| `free -m`, `swapon --show` | about 11.7 GiB and a 2 GiB swapfile |
| [Gatus](http://10.66.0.1:8080), [VictoriaMetrics](http://10.66.0.1:8428/vmui), [vmalert](http://10.66.0.1:8880), [Alertmanager](http://10.66.0.1:9093), [logs](http://10.66.0.1:9428/select/vmui) | each answers, over WireGuard only |
| `curl -XPOST http://10.66.0.1:9093/api/v2/alerts -H 'Content-Type: application/json' -d '[{"labels":{"alertname":"TestAlert"}}]'` | an email within two minutes |

Until the production stack runs ([#208][i208]), the Postgres and backup alerts fire: there is nothing to back up yet. Once it runs, `sudo hg-pgbackrest info` shows the first backup after 03:30 Toronto time, or start one: `sudo systemctl start hg-backup@pg-full`.

## What production's compose file must do

This playbook provisions the server; the production compose override (`deploy/docker-compose.prod.yml`, [#208][i208], [#296][pr296]) runs the app on it. These are the seams between the two, and the two must agree:

| Production compose | Why |
|---|---|
| Declares every network below external (this playbook creates them, with fixed subnets). The networks it creates itself (`hg-edge`, `hg-files`, `hg-egress`, `hg-analytics-proxy`, Umami's) stay on the `/29`s inside `10.88.0.0/24` listed in `hg_compose_networks` | compose files and these roles agree on names and addresses; the docker role refuses to create a network that overlaps another or one of those |
| Traefik and the API, and nothing else, on `hg-proxy` (`10.88.0.0/29`); the API's label `traefik.docker.network=hg-proxy`; `HG_TRUSTED_PROXY_CIDRS=10.88.0.0/29` | the API trusts forwarded client addresses from that range only, and only Traefik is in it besides the API's own replicas (room for four during a rollout) |
| The API, Postgres, Valkey and migrations on `hg-data` (`172.30.0.0/24`, internal). The API, Silo and the bucket job on `hg-storage` (`172.30.5.0/24`, internal), with Silo at `172.30.5.10` | postgres-exporter joins `hg-data` and the bucket backups join `hg-storage` to read them. Containers draw addresses from the upper half of each (`.128/25`), so fixed addresses below it stay free |
| No production service on `hg-monitoring` (`172.30.6.0/24`, internal) | scraping and log shipping only; the exporters reach Postgres and Silo on their own tiers |
| Clients reach Postgres, Valkey and Silo by the aliases `hg-prod-postgres`, `hg-prod-valkey` and `hg-prod-silo` | postgres-exporter and the bucket backups use them (`hg_postgres_host`, `hg_silo_endpoint`): Docker's DNS answers a plain service name for any container on the network that claims it |
| Traefik on `hg-socket` with `--providers.docker.endpoint=tcp://docker-socket-proxy:2375`, no Docker socket mount | Traefik reads Docker only through the proxy, which allows the container list, a container's inspect, events, version and ping, and nothing else: no container's files (so no `/run/secrets`), no logs, no exec, no writes |
| Traefik also on `hg-dev-proxy` and `hg-dev-edge`, with entrypoint `websecure` and certificate resolver `letsencrypt` (or change `hg_traefik_*` to match) | it routes the dev hostnames; no dev container ever joins `hg-proxy` |
| The API on `hg-scan` | clamd listens at `172.30.3.10:3310` there ([#218][i218]) |
| Traefik's networks use `gw_priority` | it needs Docker Engine 28 and compose 2.33.1 or later. The docker role keeps Engine on major version 29 (`hg_docker_engine_major`) and refuses anything older than either |
| Postgres mounts `/etc/hg/pgbackrest` at `/etc/pgbackrest` (read-only), `/srv/backup/pgbackrest` at `/var/lib/pgbackrest`, `/var/spool/hg-pgbackrest` at `/var/spool/pgbackrest`, `/var/log/hg/pgbackrest` at `/var/log/pgbackrest`, a named volume at `/var/run/postgresql`, and `env_file: /etc/hg/pgbackrest/cipher.env` | pgBackRest runs inside it for WAL and beside it (`hg-pgbackrest`) for backups |
| Postgres runs with `archive_mode=on`, `archive_command='pgbackrest --stanza=hg archive-push %p'`, `archive_timeout=60` | WAL reaches the repository within a minute |
| A `hg_monitor` role in `pg_monitor`, with `hg_monitor_postgres_password` from `host.sops.yaml` ([#215][i215]) | postgres-exporter's login |
| A read-only Silo account for backups, in `hg_backup_silo_*` ([#203][i203]) | the bucket backups' login |
| Project name `hg`, so Postgres is `hg-postgres-1` | the backups and the standby's set-up use `docker exec` by container name |
| `.env` and the four secret files come from `prod.sops.env` (see Secrets): Postgres, Valkey, Silo and the bucket job read theirs from `$HG_SECRETS_DIR`, `/srv/hg/secrets` unless set. Compose files and `acme.json` live in `/srv/hg` | the config backup covers that folder |
| Once `hg_standby_enabled` is true, Postgres at the fixed address `172.30.0.10` on `hg-data` (`ipv4_address`, beside its alias), and still no published port | the standby's replica comes in through a relay on this host, on `10.66.0.1:5432` (see "Next month") |

## Secrets

Secrets come from one place, chosen by `hg_secrets_backend`. Today that is `sops`: [sops](https://github.com/getsops/sops) files encrypted with [age](https://github.com/FiloSottile/age), kept in `~/.config/halalgoes/secrets/` on the owner's laptop, outside the repository. Ansible decrypts them on the laptop and writes only what each part of the server needs, readable by root alone. The age key never leaves the laptop and the password manager.

| File | Holds | Becomes |
|---|---|---|
| `host.sops.yaml` | the server's own secrets: console password, WireGuard keys, backup passwords, the alert email key | variables for the roles ([shape](secrets/host.example.yaml)) |
| `prod.sops.env` | production's settings ([#208][i208]) | `/srv/hg/.env`, and the secret files in `/srv/hg/secrets` |
| `dev.sops.env` | dev's settings and test-mode keys | `/srv/hg-dev/.env` ([shape](secrets/dev.example.env)) |

**Production's secret files.** Postgres, Valkey, Silo and the bucket job read their passwords from files, never from the environment (`deploy/docker-compose.prod.yml`, "Secrets"). The secrets role writes them from the same `prod.sops.env` entries as `.env`, so the two copies can't differ, into `/srv/hg/secrets` (mode 0700, root). Compose bind-mounts each file as it is on the host, ignoring a secret's uid and mode, so each is mode 0400 and owned by the uid that reads it inside its container:

| File | From | Owner |
|---|---|---|
| `postgres_password` | `POSTGRES_PASSWORD` | root: Postgres's entrypoint reads it before switching to the `postgres` user |
| `redis_password` | `REDIS_PASSWORD` | uid 999: Valkey runs as its image's `valkey` user |
| `minio_root_user` | `MINIO_ROOT_USER` | root: Silo and the bucket job |
| `minio_root_password` | `MINIO_ROOT_PASSWORD` | root: Silo and the bucket job |

A run stops if any of the four is missing from `prod.sops.env`, or if the Valkey password isn't one word (Valkey reads it from a config line; `openssl rand -hex 32` fits). A changed value reaches a container when the container is recreated.

**Pending:** a self-hosted vault (OpenBao is the likely choice) is being planned with the dev environment and needs the owner's approval ([#235][i235]). Nothing here installs one or assumes which. When it comes, it is a second backend in `roles/secrets` that produces the same variables and files; no other role changes. Ansible Vault is not used.

## Memory on the 12 GB server

Limits are ceilings, not use. Real use at launch is about 6 GB.

| What | Limit | Set by |
|---|---:|---|
| OS, dockerd, sshd, WireGuard, node-exporter | 700 MB held back | |
| Traefik | 128 MB | [#208][i208] |
| hg API, 2 replicas | 2 × 320 MB | [#208][i208] |
| Postgres + PostGIS + pgBackRest | 2,048 MB | [#208][i208] |
| Valkey, Silo, nginx | 128 + 512 + 256 MB | [#208][i208] |
| GlitchTip, Umami and their database, when they run here | 384 + 320 + 256 MB | [#208][i208] |
| Docker socket proxy | 48 MB | this playbook |
| **ClamAV** | **4,096 MB** | this playbook, until it moves to the standby |
| VictoriaMetrics, vmalert, Alertmanager | 128 + 32 + 32 MB | this playbook |
| Gatus, postgres-exporter | 48 + 32 MB | this playbook |
| VictoriaLogs, Fluent Bit | 128 + 48 MB | this playbook |
| Backup jobs, one at a time | 256 MB | this playbook |
| **Dev environment, all of it** | **1,536 MB**, a hard cap | this playbook (`hg-dev.slice`) |
| **Total** | **about 11.5 GiB of about 11.7 GiB**, plus 2 GiB of swap | |

The monthly drill adds about 1.5 GB for an hour at 04:00 on the first Tuesday, and a deploy adds 640 MB for a minute. When memory runs short (the alert fires under 15% available): stop dev first (`cd /srv/hg-dev && sudo docker compose stop`), then move ClamAV to the standby. That frees 4 GiB.

## Backups ([#64][i64])

All on this server, under `/srv/backup`, apart from the data they protect, and copied off it by the owner's machine.

| What | How | How often | Kept |
|---|---|---|---|
| Postgres | pgBackRest to an encrypted local repository (zstd, AES-256), with WAL archiving | WAL within a minute; full backup Sunday, differential other days, 03:30 Toronto | restorable to any point in the last 35 days |
| `hg-kyc`, `hg-pod` | rclone copies each bucket through the S3 API; restic snapshots the copy | every 15 minutes | every snapshot for 48 hours, then one a day for 35 days |
| `hg-media`, `hg-exports` | the same | hourly | the same |
| The pgBackRest repository | restic snapshot, so the off-server copy carries the database too | hourly | the same |
| `/etc`, `/srv/hg` (compose files, `.env`, the secret files, `acme.json`) | restic snapshot | daily | the same |
| All of the above, off the server | the owner's machine pulls new restic snapshots over WireGuard (`restic copy`) whenever it is on, at most once every 20 hours | nightly while it's on | 35 days |

- **The server can't erase the off-server copy.** The owner's machine logs in as `hg-pull`: read-only SFTP, locked inside `/srv/backup`, accepted only from that machine's WireGuard address. The server holds no credential for that machine.
- **Dev is never backed up.** It resets to the seed data: `sudo hg-dev-reset`.

**Who can touch the backups.** Nothing outside the backup jobs can delete or rewrite them:

- The restic password, the pgBackRest passphrase and the bucket-reading key sit only in `/etc/hg/backup` and `/etc/hg/pgbackrest`, readable by root. The jobs run as root; the passphrase also reaches the Postgres container, which encrypts WAL as it archives. The API and every dev container get none of them.
- The off-server copy is pulled, never pushed, with a read-only account: the server can't reach the owner's machine, and the owner's machine can't change anything on the server.
- The standby (next month) needs no backup access at all: streaming replication and bucket replication don't use the repositories. No backup credential, env file or pull key is ever written to it, and it can't log in as `hg-pull`.
- Dev's settings (`dev.sops.env`) hold only dev's own passwords and test-mode keys.
- **The monthly drill** (`hg-restore-drill`, first Tuesday, 04:00 Toronto) restores Postgres to a random point in the last day in a throwaway container. It checks that the ledger sums to zero and that row counts match production, runs `restic check --read-data-subset=5%`, and round-trips up to 20 objects through a throwaway Silo's S3 API, checking each against its `stored_object` row. Run it by hand on the owner's machine against its copy: `sudo hg-restore-drill --config /etc/hg-offline/backup.conf --no-live` (set `hg_postgres_image` first).
- **Contabo snapshots** are taken by hand, in the panel, right before a risky change (a Docker update, a migration), and deleted within 7 days ([runbook][runbook-routine]). They sit on the same host as the server, so they are not backups.

Set up the owner's machine once, from the laptop, with both on WireGuard: add its WireGuard key to `hg_wg_peers` in `inventory/hosts.yml`, run `./provision.sh`, then `ansible-playbook offline.yml`.

## Monitoring and logs ([#65][i65])

- **Alerts** go by email through Resend, from Alertmanager (metrics) and from Gatus (endpoints). Rules are in `roles/monitoring/templates/rules-*.yml.j2`: disk over 70% or due to reach 85% within 60 days, memory under 15% or under pressure, any out-of-memory kill, load, CPU steal, traffic near the port's limit, a scrape target down, any backup job failed or overdue, WAL archiving stalled or dropped, the off-server copy not pulled for 3 days, Postgres unreachable, a certificate within 14 days of expiry.
- **Gatus** on the server checks the public endpoints and the monitoring stack itself. A second Gatus on the owner's machine checks the public endpoints and the server's alerting from outside: it is the only one that can report the whole server down, and only while that machine is on.
- **Logs**: Fluent Bit reads every container's log, strips signed-link credentials and redacts phone numbers and email addresses, and stores the result in VictoriaLogs on this server: 30 days, at most 10 GiB. Docker keeps its own raw files at 5 × 20 MB per container; the journal is capped at 500 MB.
- **Not yet covered**, still open in [#65][i65]: Valkey evictions, rows in default partitions, the daily outside port scan, and hg's own metrics ([#225][i225]).

## The dev environment

A second compose project, `hg-dev`, in `/srv/hg-dev`, beside production for good ([#235][i235]):

- its own Postgres (768 MB), Valkey (64 MB) and Silo (256 MB), on `hg-dev-net`, an internal network nothing of production's joins. So no dev container has a route to production's database, Redis or buckets;
- its own Silo rather than buckets on production's. Separate keys and bucket policies on one Silo would still leave dev a network path to production's object store; a second small Silo costs about 256 MB and removes the path;
- its own hostnames through Traefik: `api.dev.`, `files.dev.`, `admin.dev.` and `restaurant.dev.` under the domain. Traefik reaches the dev API over `hg-dev-proxy`, the only range dev trusts for forwarded addresses; no dev container joins production's `hg-proxy`;
- its own settings with test-mode keys (`HG_ENV=staging`, so the API refuses a live Stripe key at boot);
- all of it in `hg-dev.slice`: at most 1.5 GiB of memory and 1.5 of the 6 vCPUs, and a fifth of production's share of CPU and disk when both are busy;
- the API image is `hg_dev_api_image` (may be newer than production's) and starts once it is set ([#78][i78]).

## Next month: the standby ([#210][i210])

Everything for the standby is off until `hg_standby_enabled` is true, so tonight's single server exposes none of it: no WireGuard peer, no replication role, no Postgres relay, no bucket replication.

1. Order the Cloud VPS for the standby. Add it under `standby` in `inventory/hosts.yml` (the commented block), with `hg_ssh_public: true` until its tunnel works.
2. In `group_vars/all.yml`, set `hg_standby_enabled: true` (and `hg_clamav_host: hg-standby` to move ClamAV). Set `hg_postgres_image` (the production Postgres image, by digest) and fill in `hg_prod_silo_root_*` in `host.sops.yaml`. In the production compose file, give Postgres the fixed address `172.30.0.10` on `hg-data` (`ipv4_address`, beside its alias). Don't publish its port: Postgres is only on internal networks, which can't have one, and the relay below takes its place.
3. `ansible-playbook bootstrap.yml --limit hg-standby -e ansible_host=<its IP> -e ansible_user=root`, then `ansible-playbook standby.yml`.

What it sets up, each with the least it needs:

- **Postgres:** a `replicator` role with `LOGIN` and `REPLICATION` only (no superuser, no grants, two connections). The standby connects to `10.66.0.1:5432`, a relay on production's host (`hg-postgres-relay`, systemd's `systemd-socket-proxyd`, two connections at most) that carries the connection to Postgres at `172.30.0.10` on `hg-data`: Docker lets the host reach a container on an internal network. The host firewall accepts that port from the standby's WireGuard address alone. Postgres sees the relay's connections come from the host's address on `hg-data`, `172.30.0.1`, so `pg_hba` admits the role for replication from there alone, and rejects every other use of it. While the standby is off, none of this is installed and the firewall drops the port for everyone.
- **Silo:** one-way bucket replication of `hg-kyc`, `hg-pod` and `hg-media`. Production configures it with a key scoped to those buckets, and replicates with a key that can only write those buckets on the standby. Production's root account is used once, to create its scoped key, and never stored in any replication setting. The standby holds no production credential, so it can't write back.
  **Not ready yet:** Silo pushes to the standby, and production's Silo is now only on internal networks, so it has no way out to the standby's address. It needs a path before the standby is switched on, for example the same kind of relay in the other direction: listening on the host's address on `hg-storage` (`172.30.5.1:9000`), accepted by the host firewall from Silo's address alone, and forwarding over WireGuard to the standby's Silo, which would then be the replication target. Until then, `standby.yml` sets up the Postgres side and stops before Silo with a message saying so.
- **The rest:** the standby becomes a WireGuard peer of production, gets the same base, firewall (WireGuard only, no public ports) and SSH settings, and runs a Gatus that watches production. clamd moves there if asked, listening on its WireGuard address for production's API alone. Production is not rebuilt.

## Routine

- **After any change here**, run `./provision.sh`. It is idempotent.
- **Ramadan:** set `hg_ramadan: true` for the month. The reboot window moves from 04:30 to 13:30 Toronto time on Sundays.
- **Docker updates** are monthly and by hand: unattended upgrades take only the distribution's security updates ([runbook][runbook-routine]).
- **A new WireGuard device:** add it to `hg_wg_peers` and run `./provision.sh`; its config appears in `out/`.
- **A rebuild** follows [the runbook][runbook-rebuild]: `./provision.sh <new IPv4>` brings the new server back with the same WireGuard key. Remove the old host key first: `ssh-keygen -R 10.66.0.1`.

## How this was checked

`tests/check.sh` passes: every playbook's syntax, ansible-lint on its production profile, and shellcheck on every script. Every template was rendered with the test inventory, and the results checked with each tool's own validator: `docker compose config` for every compose file, `amtool check-config` for Alertmanager, `vmalert -dryRun` for the 18 alert rules, VictoriaMetrics' scrape-config dry run, `sshd -t` and `sshd -T` for the SSH drop-ins, and VictoriaLogs' flags. Matching the production compose file ([#296][pr296]) was checked too:

- a script compared `hg_networks`, `hg_compose_networks`, the aliases and the secret file names with `deploy/docker-compose.prod.yml`: every external network it declares exists here with its subnet and `internal` setting, Silo's fixed address and Postgres's reserved one sit outside their networks' ranges, and nothing overlaps;
- the pinned socket proxy binary, run with the role's flags against a real Docker socket, answered ping, version, events, the container list and a container's inspect, and refused a container's archive, export and logs, `/info`, images, volumes, networks and every write;
- the secrets role, run against a test `prod.sops.env`, wrote the four files with the right values, mode 0400 and no trailing newline, changed nothing on a second run, and stopped on a missing value and on a Valkey password with a space;
- `docker_network` created networks with the configured range and gateway (Docker otherwise puts the gateway at the start of the range); `nft -c` accepts the firewall with the standby off and on (less its conntrack and rate-limit lines, which an unprivileged check can't load); `systemd-analyze verify` accepts the relay's units, and `systemd-socket-proxyd` with the same flags carried a connection.

The playbook has **not** yet run in check mode against a disposable Debian container: Docker on the machine that built this could not start containers. That run is [#275][i275].

[i207-oneserver]: https://github.com/shaiknoorullah/hg-mono/issues/207#issuecomment-5976966570
[i64]: https://github.com/shaiknoorullah/hg-mono/issues/64
[i65]: https://github.com/shaiknoorullah/hg-mono/issues/65
[i78]: https://github.com/shaiknoorullah/hg-mono/issues/78
[i203]: https://github.com/shaiknoorullah/hg-mono/issues/203
[i208]: https://github.com/shaiknoorullah/hg-mono/issues/208
[i210]: https://github.com/shaiknoorullah/hg-mono/issues/210
[i215]: https://github.com/shaiknoorullah/hg-mono/issues/215
[i218]: https://github.com/shaiknoorullah/hg-mono/issues/218
[i225]: https://github.com/shaiknoorullah/hg-mono/issues/225
[i235]: https://github.com/shaiknoorullah/hg-mono/issues/235
[i275]: https://github.com/shaiknoorullah/hg-mono/issues/275
[pr278]: https://github.com/shaiknoorullah/hg-mono/pull/278
[pr296]: https://github.com/shaiknoorullah/hg-mono/pull/296
[runbook-routine]: ../../docs/ops/runbook.md#routine-work-on-one-server
[runbook-rebuild]: ../../docs/ops/runbook.md#rebuild-on-a-new-server
