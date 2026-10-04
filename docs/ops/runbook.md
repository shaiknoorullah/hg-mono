---
covers:
  - deploy/**
  - services/hg/internal/orders/runner*.go
reviewed: 2026-10-04
---

# Incident runbook

What to do when production breaks. Releasing is in [the release runbook](../../RELEASING.md).

Production is **one** Contabo Cloud VPS 6 in US-East ([the owner's decision of 4 Oct][one-box], [hosting plan][i207]). The warm standby ([#210][i210]) comes next month. Until then, losing the server means a **rebuild from backups**, not a failover. The [last section](#next-month-the-standby) says what changes once the standby runs.

Steps marked *(lands with #N)* depend on work that is not merged yet. Use them as written once it is.

**The dev environment** ([#235][i235], being planned) runs beside prod on the same server. It is never restored from backups: once prod is back, reset dev from the fixtures. When the server is short of memory or disk, stop dev first.

## Recovery targets, one server

Estimates until [the drill](#monthly-restore-drill) measures them. Replace them with measured times.

| What broke | Data lost | Back in |
|---|---|---|
| The API crashed, or the server rebooted | none | minutes |
| A bad deploy with no migration | none | minutes: deploy the previous image |
| A bad migration or a corrupt database, server fine | every write after the restore point you choose | about an hour |
| Server dead, disk still readable from Contabo's rescue system | about 1 minute of database changes, and files since the last bucket snapshot | Contabo's delivery time for a new server (hours, sometimes a day), then 1–2 hours |
| Server and disk lost | everything since the last nightly copy reached the owner's machine: up to a day, more if that machine was off | Contabo's delivery time, then 1–2 hours, plus the upload from the owner's machine (about an hour per 10 GB at 20 Mbit/s) |
| Contabo account lost | the same as above | days: a new account can be held for an ID check |

The only copy outside the server is the nightly one the owner's machine pulls ([#64][i64]). If that pull hasn't run for days, days of data are at risk.

## Who does what

| Role | Who | Does |
|---|---|---|
| On-call | Mr. Sufiyan ([#169][i169]). His phone number is kept in the secrets store (the vault from [#235][i235], or the encrypted env file until then), never in this repository | First response. Runs this runbook, over WireGuard and SSH. Calls the owner for anything in the next paragraph |
| Owner | HalalGoes's owner | Holds the Contabo account (with 2FA), DNS, the Stripe, Twilio and Resend accounts, the machine with the off-server copy and the offline password manager. Orders a new server. Speaks to restaurants and the public |
| Privacy officer | *To be named: [#214][i214]* | Keeps the breach log. Decides with the owner whether a breach is reported |
| Support agents | Admin support staff | Answer customers from the support version of the System page ([decision][dec-support]) |

Call the owner at once for: a rebuild, lost data, money that doesn't match, or a suspected breach.

One person runs commands on the server at a time. Keep a timeline as you go, in UTC: the Stripe catch-up and the breach log both need it.

## How to tell what's broken

1. **From outside.** `curl -fsS https://<api host>/health` says the process is alive. `/health/ready` returns 503 and names the failing dependency: Postgres, Redis, object storage or Stripe. If neither answers, it is the server, the network or Traefik.
2. **Alerts** arrive by email through Resend ([#65][i65]). Only the watcher on the owner's machine can report that the whole server is down, and only while that machine is on. No alert is not proof that all is well.
3. **Contabo:** is the server running in the panel? Is there an incident on [Contabo's status page](https://contabo-status.com/)?
4. **Providers:** [Stripe](https://status.stripe.com/), [Twilio](https://status.twilio.com/), [Resend](https://resend-status.com/).
5. **On the server** (SSH over WireGuard): `docker compose ps`, `docker compose logs --since 30m api`, `df -h`, `free -m`, and `dmesg -T | grep -i oom` for out-of-memory kills.
6. **Errors and checks:** GlitchTip for API errors; the admin System page for start-up checks and reconciliation exceptions ([#171][i171]).

| You see | Go to |
|---|---|
| Nothing answers; the panel shows the server stopped or unreachable | [The server is down](#the-server-is-down) |
| `/health/ready` names Postgres, or writes fail | [The database is corrupt or a bad migration ran](#the-database-is-corrupt-or-a-bad-migration-ran), or [the disk is full](#the-disk-is-full) |
| "No space left on device" in the logs | [The disk is full](#the-disk-is-full) |
| A certificate warning in the browser | [Certificates are expiring](#certificates-are-expiring) |
| New sign-ins fail; a sticky banner on every admin page | [The sign-in code sender is down](#the-sign-in-code-sender-is-down) |
| Checkout fails; `/health/ready` names Stripe; reconciliation exceptions | [Payments are failing](#payments-are-failing) |
| Access nobody can explain, or a leaked secret | [A suspected breach](#a-suspected-breach) |

## Pause new orders

One switch stops new orders on the whole platform and leaves everything else running ([#244][i244]). Use it before phoning restaurants and before stopping the API.

**Who:** an `ADMIN` or `SUPER_ADMIN`. A support agent can see whether it is on, but cannot change it.

**Turn it on** with the API (`setOrderingPause` in [the contract](../../contracts/openapi.yaml)); the admin console gets a button for it with [#389](https://github.com/shaiknoorullah/hg-mono/issues/389). The access token is the one `login` returns when you sign in with your email, password and two-step code; it lasts 15 minutes.

```sh
curl -fsS -X PUT https://<api host>/v1/admin/ordering-pause \
  -H "Authorization: Bearer <your admin access token>" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"paused": true, "reason": "Stripe is refusing authorisations; see the incident timeline"}'
```

The reason is required (10 to 500 characters) and goes into the audit log with your account, as action `ordering.pause`. Write it for the next person on call. Note the UTC time in the timeline.

**What changes, on every API replica, from the next request:**

- New quotes and new orders are refused with `409 ORDERING_PAUSED`. Nothing is stored and nothing is charged.
- The public config says `"ordering": {"paused": true}` and the cart says `ORDERING_PAUSED`, so the customer app can say ordering is paused instead of failing at checkout *(the app side lands with [#388](https://github.com/shaiknoorullah/hg-mono/issues/388))*.
- Every order already placed carries on to the end: restaurant accept and reject, riders, tracking, payments (capture on acceptance, voids), refunds and the staff tools. Offers already sent keep their full 180-second window.

The switch lives in Postgres, not Redis: flushing or restarting Redis does not turn it off, and nothing needs flushing to turn it on.

**Check it:** `GET /v1/admin/ordering-pause` shows `paused`, `paused_since`, the reason and who changed it last. `GET /v1/config/public` shows `"ordering": {"paused": true, …}`.

**Turn it off** the same way, with `"paused": false` and a reason (action `ordering.resume` in the audit log). Ordering resumes on the next request. Customers whose checkout was refused can try again with the same request.

**If the API is down** the switch cannot be reached. Then:

- Phone each restaurant and ask them to switch off accepting orders in the restaurant app.
- Last resort: stop the API. That stops everything (tracking, rider updates, the staff tools), not only new orders. When it restarts, the deadline runner's outage handling covers the gap *(lands with [#222][i222])*.

## Roll back a bad deploy

Images are pulled by digest ([#78][i78]) and deployed by the rollout script in the production compose override ([#208][i208]). Write each deployed digest in the timeline.

1. Deploy the previous digest the same way. Nothing else.
2. If the release ran a migration, check that the old code still works on the new schema. If it doesn't, go to the next section.

Before any deploy that runs a migration, take a Contabo snapshot and write down the UTC time: that time is the restore point if the migration goes wrong.

## The database is corrupt or a bad migration ran

The server works; the data doesn't.

1. [Pause new orders](#pause-new-orders), then `docker compose stop api` so nothing writes on top.
2. Pick the smallest fix:
   - **Fix forward** with a new migration, when no data was lost. Preferred.
   - **The migration's own down step**, only if it is known safe and loses nothing.
   - **Point-in-time restore**, when data was destroyed. Every write after the restore point is lost.
3. Restore to a point in time:
   1. Pick the target: the UTC time just before the migration or the damage.
   2. Stop Postgres.
   3. In a one-off container of the Postgres image (it carries pgBackRest, [#78][i78]) with the data volume mounted, run `pgbackrest --stanza=<stanza> --delta --type=time "--target=<YYYY-MM-DD HH:MM:SS+00>" --target-action=promote restore`. Without `--target-action=promote`, Postgres stays paused at the target.
   4. Start Postgres. Its log names the point where recovery stopped.
   5. Check the ledger: `SELECT batch_id FROM ledger_entry GROUP BY batch_id HAVING sum(amount_cents) <> 0;` returns no rows ([every order's money decomposes to zero (invariant 6)](../../AGENTS.md#3-non-negotiable-invariants)).
4. Then run [steps 9 to 12 of the rebuild](#rebuild-on-a-new-server): the API with the runner held, the Stripe catch-up from the restore point, the missing-file check, the runner released.

A Contabo snapshot reverts the **whole** server, the backups on it included, to the moment it was taken. Use one only when the server itself is broken (a failed OS or Docker update), not for the database.

## The server is down

### First: is it really gone?

A rebuild from the nightly copy can lose a day. Try the cheaper ways first:

- **Contabo is fixing it** (the status page or support gives a time): waiting may lose nothing.
- **The OS is broken but the disk is fine:** boot Contabo's rescue system and copy the backup repositories (pgBackRest and restic) off the disk. Then rebuild from those: about a minute lost, not a day.
- **The disk is gone:** rebuild from the copy on the owner's machine.

If it came back by itself after a crash, nothing was lost. The runner's outage handling *(lands with [#222][i222])* deals with deadlines that fell in the gap, and Stripe retries webhook deliveries for up to three days ([Stripe docs](https://docs.stripe.com/webhooks#retries)).

### Rebuild on a new server

1. **Tell people.** Phone the restaurants. The admin app goes down with the server, so tell support what to say to customers.
2. **Get a server.** Order a Cloud VPS 6 in US-East, or reinstall the old one from Contabo's panel if only its software is broken. Note its IPv4 and IPv6 addresses.
3. **Provision it** with the Ansible playbooks from [#209][i209] (branch `chore/server-provisioning`, landing in deploy/host): firewall, WireGuard, SSH, updates, Docker, log limits. Reuse the old server's WireGuard keys from the config backup, so peers only need the new address.
4. **Copy the backups up** over WireGuard: the pgBackRest and restic repositories, from the owner's machine or from the rescued disk. The backup passwords are in the offline password manager.
5. **Restore the config and secrets.** `restic -r <repo> snapshots` lists the snapshots. Restore the newest config snapshot into a scratch folder with `restic -r <repo> restore <id> --target /srv/restore/config`, then copy into place the compose files, `acme.json` (mode 600) and the WireGuard config. Do not copy the old `/etc` over the new one. Restore the secrets store: the vault or the encrypted env file, whichever is live ([#235][i235], [#54][i54]). Its unseal or decryption keys are in the offline password manager.
6. **Pull the images** by the digests in the restored compose files: `docker compose pull`.
7. **Restore Postgres** in a one-off container of the Postgres image, with the empty data volume mounted:
   - to the newest point the backups hold: `pgbackrest --stanza=<stanza> restore`;
   - or to a chosen time, as in [the database section](#the-database-is-corrupt-or-a-bad-migration-ran).

   Start Postgres. The newest `created_at` in `"order"` tells you where the data ends: that is the **restore point**. Write it in the timeline.
8. **Restore the buckets.** Restore the newest bucket snapshot with `restic -r <repo> restore <id> --target /srv/restore/buckets`. Start Silo and run the bucket setup ([#202][i202]); never set bucket policies by hand, because the KYC bucket must stay private ([documents live in private buckets (invariant 7)](../../AGENTS.md#3-non-negotiable-invariants)). Upload through the S3 API, one bucket at a time: `rclone copy /srv/restore/buckets/hg-kyc silo:hg-kyc`. Never copy files into Silo's data folder.
9. **Start the API with the deadline runner held** *(lands with [#222][i222]: set its start-up switch in the secrets store)*, with Valkey, Traefik and nginx. Valkey starts empty, which is fine: the system is correct without it ([Redis is disposable](../spec/01-platform.md#0-ground-rules-that-bind-every-section)). Check `/health/ready` over WireGuard. DNS still points at the old address, so no customer traffic arrives yet.
10. **Run the Stripe catch-up** from a few minutes before the restore point: `docker compose exec api hg stripe-catchup --since <time>`, where `<time>` is an RFC 3339 time in UTC (`2026-10-01T03:00:00Z`) or a duration back from now (`90m`). It replays Stripe's events through the normal webhook path, then checks every payment written in the last 24 hours against Stripe, so running it twice is safe. Each disagreement it will not settle by itself is filed as a reconciliation exception and listed on every run, and the command exits non-zero, until a person resolves it: each one goes through [the payments section](#payments-are-failing).
11. **Find files that never came back.** Until [#245][i245] adds the check, compare `READY` `stored_object` rows with the restored buckets and give the list to support, who ask those applicants to upload again. Never edit or delete the rows by hand.
12. **Release the runner** with the release step from [#222][i222]. Deadlines that fell in the gap take the outage path: an order not yet accepted is voided with an outage notice and counts against nobody, and a paid order fires once without using up an escalation. **Nobody edits `deadline_at` by hand** ([every non-terminal order state carries a deadline (invariant 4)](../../AGENTS.md#3-non-negotiable-invariants); [deadlines spec][p15]).
13. **Switch DNS.** Point the A and AAAA records of every name on the server (the API, `files.`, admin, restaurant and the marketing site) at the new addresses. TTLs are 300 s, so most clients move within minutes. Contabo has no floating IP: DNS is how traffic moves. The restored `acme.json` serves valid certificates at once; without it, Traefik gets new ones as soon as DNS points here.
14. **Check from outside:** `/health/ready` over HTTPS, a sign-in, the admin System page, GlitchTip.
15. **Back up at once.** Take a full backup (`pgbackrest --stanza=<stanza> --type=full backup`) and a restic snapshot, and make sure the owner's machine pulls them tonight. Until it does, the new server holds the only copy.
16. **Afterwards.** Reset dev from the fixtures. Cancel the old server once nothing more can come off it. If personal information was lost (KYC uploads that never reached a backup, for example), [record it as a breach](#a-suspected-breach). Write up the timeline and the measured times.

**Contabo account lost:** the same steps, into a new Contabo account, from the copy on the owner's machine.

## The disk is full

1. Find what grew: `df -h /`, `docker system df`, `du -xh --max-depth=2 /var/lib/docker/volumes | sort -h | tail`.
2. Safe to clear: old images (`docker image prune -af --filter until=168h`), the build cache (`docker builder prune -f`), the journal (`journalctl --vacuum-size=200M`), and dev's data (it resets from the fixtures).
3. **Never delete by hand:** anything in Postgres's data folder, `pg_wal` included; the pgBackRest repository (use `pgbackrest expire`); the restic repository (use `restic forget --prune`); Silo's data folder.
4. A growing `pg_wal` means WAL archiving is failing. Run `pgbackrest --stanza=<stanza> check` and fix the archive; don't remove WAL.
5. If Postgres stopped, free space and start it again. It recovers by itself.
6. Afterwards, apply the disk trigger in [the hosting plan][i207]: over 70% full, or due to reach 85% within 60 days, means a bigger disk.

## Certificates are expiring

Traefik renews the Let's Encrypt certificates itself, about 30 days before they expire, through port 443 ([#51][i51]). Let's Encrypt [stopped sending expiry emails in 2025](https://letsencrypt.org/2025/01/22/ending-expiration-emails/), so the watchers must check expiry dates ([#65][i65]).

1. Check one: `echo | openssl s_client -connect <host>:443 -servername <host> 2>/dev/null | openssl x509 -noout -enddate`.
2. Read `docker compose logs traefik | grep -i acme`. The usual causes: port 443 blocked; an A or AAAA record pointing somewhere else; `acme.json` missing or not mode 600.
3. Don't delete `acme.json` to force a new certificate: Let's Encrypt allows 5 certificates a week for the same names.

A restaurant's halal certificate expiring is a product state, not an incident. The app shows it in cool slate ("we can't currently vouch"), never red ([never red for a halal state (invariant 9)](../../AGENTS.md#3-non-negotiable-invariants)).

## The sign-in code sender is down

Sign-in codes go through Twilio Verify, by WhatsApp or text message ([phone sign-in spec][p02]).

- **What breaks:** customers and riders can't sign in, or sign in on a new device. Anyone already signed in carries on. Staff sign in with email, password and an authenticator code, so they are unaffected.
- **Signs:** the sender check fails and a sticky banner shows on every admin page ([decision][dec-sms]); Twilio errors in the API logs.
- **Check** [Twilio's status page](https://status.twilio.com/) and the Twilio console: Verify logs, account balance, suspension, and whether the credentials were changed.

If only WhatsApp fails, switch to text messages: set `HG_TWILIO_VERIFY_CHANNEL=sms` in the secrets store and restart the API replicas one at a time. Switch back when WhatsApp recovers.

If Twilio itself is down or the account is blocked, there is nothing to switch to: the owner contacts Twilio and support tells customers. Don't change `HG_OTP_PROVIDER` during an incident: the other path sends through Twilio's message sender, which needs its own registered number and has never run in production.

If Twilio is fine but every customer is refused with "too many attempts" at once, the API is probably taking Traefik's address as everyone's, so one per-address limit covers all of them. The API logs `trusted proxies:` at start-up: check that `HG_TRUSTED_PROXY_CIDRS` in the secrets store covers the network Traefik reaches the API from (`docker network inspect hg-net -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'`), then restart the replicas one at a time. Never set it to `0.0.0.0/0`: the API refuses to start with it ([middleware chain, client-address step](../spec/01-platform.md#p-06--deny-by-default-routing-and-the-middleware-chain)).

## Payments are failing

- **Signs:** checkout errors; `/health/ready` names Stripe; failed deliveries under the webhook endpoint in Stripe's dashboard; reconciliation exceptions on the System page.
- **Check** [Stripe's status page](https://status.stripe.com/), API errors and webhook deliveries in Stripe's dashboard, and the API logs.
- **Stripe is down:** [pause new orders](#pause-new-orders). Orders already authorised stay authorised, and nothing is charged until a restaurant accepts ([authorise then capture (invariant 5)](../../AGENTS.md#3-non-negotiable-invariants)). When Stripe is back, run the Stripe catch-up from the start of the outage ([#223][i223]) and work through the reconciliation exceptions.
- **Stripe shows our endpoint answering 400:** the webhook signing secret doesn't match, usually after a rotation. Put the right `HG_STRIPE_WEBHOOK_SECRET` in the secrets store and restart the replicas one at a time. Stripe retries for up to three days, so the events arrive; run the catch-up anyway.
- Card declines are not an incident.
- **Never** write payment states or ledger rows by hand, and never refund outside the admin refund flow: the ledger is append-only ([ledger spec][p13]).

**A reconciliation exception** ([reconciliation spec][p17]; the steps on the System page, [approved by the owner][dec-recon]):

1. Open the order.
2. Follow this runbook before changing anything: compare the order with its payment in Stripe's dashboard. If Stripe has events the order hasn't seen, run the catch-up for that window.
3. Call on-call if the customer was overcharged or the order can't be matched.

## A suspected breach

PIPEDA covers this ([the Privacy Commissioner's guidance][opc-breach]; [#214][i214]). The loss of personal information counts too, not only access by someone else.

1. **Contain, keeping the evidence.** Revoke whatever was used: rotate the secret in the secrets store, sign the sessions out, close the port, disable the account. Before wiping or rebuilding anything, copy the logs off the server and take a Contabo snapshot.
2. **Start the breach record now:** the date or estimated date, what happened, what information was involved, who is affected, what was done. **Every** breach goes in the log, reported or not, and stays there for **24 months** at least. The log's home is set in [#214][i214]; never in this repository, because it holds personal information.
3. **Assess the real risk of significant harm:** how sensitive the information is and how likely it is to be misused. Identity documents and licences in the KYC bucket are highly sensitive.
4. **If there is a real risk of significant harm:**
   - report it to the [Privacy Commissioner of Canada](https://www.priv.gc.ca/en/report-a-concern/report-a-privacy-breach-at-your-organization/) as soon as feasible;
   - tell the people affected, directly, as soon as feasible;
   - tell any organization that can reduce the harm, such as Stripe, Twilio or the police.
5. **Quebec residents affected:** Quebec's privacy law also requires notifying [Quebec's privacy regulator](https://www.cai.gouv.qc.ca/). Ask counsel.

On-call contains. The privacy officer and the owner decide what is reported, and when.

## Routine work on one server

- **Reboots.** A timer reboots only when a reboot is pending: about 04:30 Toronto time on Sunday, early afternoon during Ramadan. About 2 minutes down. Anything longer waits for that window, with new orders paused and a Contabo snapshot taken first.
- **Docker updates.** Monthly, by hand: unattended upgrades don't cover Docker's repository. Take a snapshot first, in the quiet window. Afterwards, check the published port still reaches the API: a new Docker once broke an old Traefik ([#228][i228]).
- **WireGuard is broken.** Get in through Contabo's rescue system, or switch on the VNC console in the panel for that emergency only. VNC is unencrypted and uses only the first 8 characters of its password. Log in with the local account's long password, then switch VNC off.
- **Changing plan.** Contabo doesn't resize in place. Until the standby runs, a plan change is a planned rebuild (a fresh backup, new orders paused, then [the rebuild steps](#rebuild-on-a-new-server)) or Contabo's paid live migration. Take the free snapshot first. Never during Ramadan.

## Monthly restore drill

Restore from the copy on the owner's machine: it is the one a rebuild uses. Work in a scratch folder, start containers with `--rm`, and wipe both afterwards.

1. Restore the database to a chosen point in time in a throwaway Postgres.
2. Check the ledger: `SELECT batch_id FROM ledger_entry GROUP BY batch_id HAVING sum(amount_cents) <> 0;` returns no rows, and the row counts of `"order"`, `ledger_entry` and `stored_object` match a count taken on prod at that point.
3. Run `restic -r <repo> check --read-data-subset=5%`.
4. Restore 20 random objects and check each one's size and SHA-256 against its `stored_object` row.
5. Write down how long each step took. A failure is an incident.

The watchers alert when a backup or a drill is overdue ([#65][i65]). Before launch, rebuild the production server itself, reinstalled from Contabo's panel, and time every step ([#64][i64]). Publish the measured times in [the targets](#recovery-targets-one-server).

## Next month: the standby

Once the standby runs ([#210][i210]), a dead prod server means a **failover**: about 15–30 minutes and seconds of data, with no wait for Contabo (estimates until a drill). In this order ([#66][i66-plan]):

1. Power prod off in Contabo's panel, so two databases never take writes.
2. Promote the standby's Postgres. Restore the latest config snapshot (already on the standby) and start the app stack there; the images are already pulled.
3. Start the API with the deadline runner held, and run the Stripe catch-up from the time of the last replicated change.
4. Find the files that never arrived ([#245][i245]); those applicants upload again.
5. Release the runner. Nobody edits `deadline_at` by hand.
6. Switch DNS on the 300 s TTL.
7. Take a full backup on the new primary and rebuild the old prod as the new standby promptly: until then, the off-server copy is the only other one.

Also: reboots and plan changes longer than about 2 minutes fail over first; the monthly drill moves to the standby; ClamAV moves there with one setting; and a rebuild is needed only when both servers are lost.

[one-box]: https://github.com/shaiknoorullah/hg-mono/issues/207#issuecomment-5976966570
[i207]: https://github.com/shaiknoorullah/hg-mono/issues/207
[i210]: https://github.com/shaiknoorullah/hg-mono/issues/210
[i235]: https://github.com/shaiknoorullah/hg-mono/issues/235
[i64]: https://github.com/shaiknoorullah/hg-mono/issues/64
[i65]: https://github.com/shaiknoorullah/hg-mono/issues/65
[i169]: https://github.com/shaiknoorullah/hg-mono/issues/169
[i214]: https://github.com/shaiknoorullah/hg-mono/issues/214
[i171]: https://github.com/shaiknoorullah/hg-mono/issues/171
[i244]: https://github.com/shaiknoorullah/hg-mono/issues/244
[i222]: https://github.com/shaiknoorullah/hg-mono/issues/222
[i78]: https://github.com/shaiknoorullah/hg-mono/issues/78
[i208]: https://github.com/shaiknoorullah/hg-mono/issues/208
[i209]: https://github.com/shaiknoorullah/hg-mono/issues/209
[i54]: https://github.com/shaiknoorullah/hg-mono/issues/54
[i202]: https://github.com/shaiknoorullah/hg-mono/issues/202
[i223]: https://github.com/shaiknoorullah/hg-mono/issues/223
[i245]: https://github.com/shaiknoorullah/hg-mono/issues/245
[i51]: https://github.com/shaiknoorullah/hg-mono/issues/51
[i228]: https://github.com/shaiknoorullah/hg-mono/issues/228
[i66-plan]: https://github.com/shaiknoorullah/hg-mono/issues/66#issuecomment-5936436860
[p02]: ../spec/01-platform.md#p-02--phone-otp-authentication-customers-riders
[p15]: ../spec/01-platform.md#p-15--deadlines-and-timeout-actions-waits-forever-is-unrepresentable
[p13]: ../spec/01-platform.md#p-13--the-ledger-and-the-zero-residual-invariant
[p17]: ../spec/01-platform.md#p-17--webhooks-idempotency-and-reconciliation
[dec-support]: ../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01
[dec-sms]: ../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01
[dec-recon]: ../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01
[opc-breach]: https://www.priv.gc.ca/en/privacy-topics/business-privacy/breaches-and-safeguards/privacy-breaches-at-your-business/gd_pb_201810/
