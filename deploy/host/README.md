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
| `group_vars/all.yml` | Every shared setting, and every container image pinned by tag and digest |
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
| `free -m`, `swapon --show` | about 11.7 GiB and a 2 GiB swapfile |
| [Gatus](http://10.66.0.1:8080), [VictoriaMetrics](http://10.66.0.1:8428/vmui), [vmalert](http://10.66.0.1:8880), [Alertmanager](http://10.66.0.1:9093), [logs](http://10.66.0.1:9428/select/vmui) | each answers, over WireGuard only |
| `curl -XPOST http://10.66.0.1:9093/api/v2/alerts -H 'Content-Type: application/json' -d '[{"labels":{"alertname":"TestAlert"}}]'` | an email within two minutes |

Until the production stack runs ([#208][i208]), the Postgres and backup alerts fire: there is nothing to back up yet. Once it runs, `sudo hg-pgbackrest info` shows the first backup after 03:30 Toronto time, or start one: `sudo systemctl start hg-backup@pg-full`.

## What production's compose file must do

This playbook provisions the server; the production compose override ([#208][i208]) runs the app on it. These are the seams between the two:

| Production compose | Why |
|---|---|
| Declares `hg-net` external (this playbook creates it, with the other networks) | the monitoring and backup containers join it |
| Traefik on `hg-socket` with `--providers.docker.endpoint=tcp://docker-socket-proxy:2375`, no Docker socket mount | Traefik reads Docker only through the read-only proxy |
| Traefik also on `hg-dev-edge`, with entrypoint `websecure` and certificate resolver `letsencrypt` (or change `hg_traefik_*` to match) | it routes the dev hostnames |
| The API on `hg-scan` | clamd listens at `172.30.3.10:3310` there ([#218][i218]) |
| Postgres mounts `/etc/hg/pgbackrest` at `/etc/pgbackrest` (read-only), `/srv/backup/pgbackrest` at `/var/lib/pgbackrest`, `/var/spool/hg-pgbackrest` at `/var/spool/pgbackrest`, `/var/log/hg/pgbackrest` at `/var/log/pgbackrest`, a named volume at `/var/run/postgresql`, and `env_file: /etc/hg/pgbackrest/cipher.env` | pgBackRest runs inside it for WAL and beside it (`hg-pgbackrest`) for backups |
| Postgres runs with `archive_mode=on`, `archive_command='pgbackrest --stanza=hg archive-push %p'`, `archive_timeout=60` | WAL reaches the repository within a minute |
| A `hg_monitor` role in `pg_monitor`, with `hg_monitor_postgres_password` from `host.sops.yaml` ([#215][i215]) | postgres-exporter's login |
| A read-only Silo account for backups, in `hg_backup_silo_*` ([#203][i203]) | the bucket backups' login |
| Project name `hg`, so Postgres is `hg-postgres-1`; Silo's service `minio` (or change `hg_silo_endpoint`) | the scripts address them by name |
| `.env` comes from `prod.sops.env` (see Secrets), with `HG_TRUSTED_PROXY_CIDRS=172.30.0.0/24`; compose files and `acme.json` live in `/srv/hg` | `hg-net`'s subnet is fixed here, so Traefik's address is known; the config backup covers that folder |

## Secrets

Secrets come from one place, chosen by `hg_secrets_backend`. Today that is `sops`: [sops](https://github.com/getsops/sops) files encrypted with [age](https://github.com/FiloSottile/age), kept in `~/.config/halalgoes/secrets/` on the owner's laptop, outside the repository. Ansible decrypts them on the laptop and writes only what each part of the server needs, readable by root alone. The age key never leaves the laptop and the password manager.

| File | Holds | Becomes |
|---|---|---|
| `host.sops.yaml` | the server's own secrets: console password, WireGuard keys, backup passwords, the alert email key | variables for the roles ([shape](secrets/host.example.yaml)) |
| `prod.sops.env` | production's settings ([#208][i208]) | `/srv/hg/.env` |
| `dev.sops.env` | dev's settings and test-mode keys | `/srv/hg-dev/.env` ([shape](secrets/dev.example.env)) |

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
| Docker socket proxy | 32 MB | this playbook |
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
| `/etc`, `/srv/hg` (compose files, `.env`, `acme.json`) | restic snapshot | daily | the same |
| All of the above, off the server | the owner's machine pulls new restic snapshots over WireGuard (`restic copy`) whenever it is on, at most once every 20 hours | nightly while it's on | 35 days |

- **The server can't erase the off-server copy.** The owner's machine logs in as `hg-pull`: read-only SFTP, locked inside `/srv/backup`. The server holds no credential for that machine.
- **Dev is never backed up.** It resets to the seed data: `sudo hg-dev-reset`.
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
- its own hostnames through Traefik: `api.dev.`, `files.dev.`, `admin.dev.` and `restaurant.dev.` under the domain;
- its own settings with test-mode keys (`HG_ENV=staging`, so the API refuses a live Stripe key at boot);
- all of it in `hg-dev.slice`: at most 1.5 GiB of memory and 1.5 of the 6 vCPUs, and a fifth of production's share of CPU and disk when both are busy;
- the API image is `hg_dev_api_image` (may be newer than production's) and starts once it is set ([#78][i78]).

## Next month: the standby ([#210][i210])

1. Order the Cloud VPS for the standby. Add it under `standby` in `inventory/hosts.yml` (the commented block), with `hg_ssh_public: true` until its tunnel works.
2. Set `hg_postgres_image` (the production Postgres image, by digest), add `hg_prod_silo_root_*` to `host.sops.yaml`, and publish production's Postgres on `10.66.0.1:5432` in the compose file. To move ClamAV, change `hg_clamav_host` to `hg-standby` in `group_vars/all.yml`.
3. `ansible-playbook bootstrap.yml --limit hg-standby -e ansible_host=<its IP> -e ansible_user=root`, then `ansible-playbook standby.yml`.

That adds the standby as a WireGuard peer of production, starts a streaming replica and a Silo replica, sets up bucket replication from production, starts a Gatus there that watches production, and moves clamd (listening on the standby's WireGuard address) if asked. Production is not rebuilt.

## Routine

- **After any change here**, run `./provision.sh`. It is idempotent.
- **Ramadan:** set `hg_ramadan: true` for the month. The reboot window moves from 04:30 to 13:30 Toronto time on Sundays.
- **Docker updates** are monthly and by hand: unattended upgrades take only the distribution's security updates ([runbook][runbook-routine]).
- **A new WireGuard device:** add it to `hg_wg_peers` and run `./provision.sh`; its config appears in `out/`.
- **A rebuild** follows [the runbook][runbook-rebuild]: `./provision.sh <new IPv4>` brings the new server back with the same WireGuard key. Remove the old host key first: `ssh-keygen -R 10.66.0.1`.

## How this was checked

`tests/check.sh` passes: every playbook's syntax, ansible-lint on its production profile, and shellcheck on every script. Every template was rendered with the test inventory, and the results checked with each tool's own validator: `docker compose config` for every compose file, `amtool check-config` for Alertmanager, `vmalert -dryRun` for the 18 alert rules, VictoriaMetrics' scrape-config dry run, `sshd -t` and `sshd -T` for the SSH drop-ins, and VictoriaLogs' flags. The playbook has **not** yet run in check mode against a disposable Debian container: Docker on the machine that built this could not start containers. That run is [#275][i275].

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
[runbook-routine]: ../../docs/ops/runbook.md#routine-work-on-one-server
[runbook-rebuild]: ../../docs/ops/runbook.md#rebuild-on-a-new-server
