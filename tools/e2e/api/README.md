---
covers:
  - tools/e2e/api/**
reviewed: 2026-10-10
---

# API journey runner

This runner drives the HalalGoes launch path against an API you name. The request shapes come from the [API contract](../../../contracts/openapi.yaml).

Run it with Node 22. It is not part of `pnpm test`.

```bash
node tools/e2e/api/run.mjs --base http://127.0.0.1:8080
```

`--base` is required. There is no default host. An unknown argument exits 2.

## What the runner refuses

Phone numbers are fictional only: a North American number whose exchange is 555 and whose line is 0100 through 0199. Any other number is refused before a sign-in request is sent.

The payment key must be a local test-mode secret key. The runner reads `STRIPE_SECRET_KEY`, then `STRIPE_API_KEY`, then `STRIPE_SECRET`, and otherwise the file named by `E2E_STRIPE_ENV` if that variable is set. There is no default secrets path, and the key is not read over SSH. A missing key, a live key, or an unrecognised key stops the run before any request.

The API must report its own environment as `local` or `staging`. The runner reads `GET /internal/deps`. It does not guess, and it does not open a shell on the server to find out.

An anonymous call that returns 401 means the route is present and needs the test staff account. The runner signs in and reads the report. A 403, a 404, a network error, or any other non-report stops the run before that sign-in. After a report is actually returned, `production` or any value other than `local` or `staging` stops the run before an issuing body, a registration, a phone sign-in, or an order. The edge allowlist for `/internal` and `/debug` is not a bypass: when it answers 403, the runner stops.

## Test staff account

Set `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, and `E2E_ADMIN_TOTP_SECRET`. The runner does not invite the account, and it does not read an owner login file.

After sign-in the roles must include `ADMIN` and must not include the owner role. Any other result stops the run.

A person with the owner role invites the account with `POST /v1/admin/staff` (`email`, `full_name`, `role` of `ADMIN`, and an `Idempotency-Key`). The account is created invited, with no password. The invitee sets a password with `POST /v1/auth/password/reset` using the emailed token. That call issues no session. The invitee signs in and enrols an authenticator with `POST /v1/auth/totp/enroll`, then confirms it with `POST /v1/auth/totp/verify`. The account is active only after both. The behaviour is [staff account provisioning](../../../docs/spec/05-admin.md).

## Issuing bodies and cleanup

The runner uses an issuing body that is already accepted. It does not propose one and it does not accept one. When the accepted list is empty, that step is blocked, and the document and certificate steps that need the body are blocked with it.

At the end the runner turns accepting-orders off when this run turned it on, and it cancels customer orders this run created when that order is still cancellable. It does not delete the restaurant, the accounts, or the documents. This API has no such delete. Point the runner at a database that a dev-world reset wipes.

## Reports and log access

At pickup the rider sends the 4-digit pickup code the kitchen reads out, as the rider app does. The runner takes it from the restaurant's ready response, or from `GET /v1/restaurant/orders/{orderId}`, the only views that carry it. With no code on either, the delivery step fails as `PICKUP_CODE_MISSING`.

Each run writes `steps.md` and `report.json` under `tools/e2e/api/.reports/<timestamp>/`. That directory is git-ignored. `--report-dir` chooses a different directory. The report records the payment-key mode and never the key.

Phone sign-in codes are still read from API logs until the dev-world scenario work is deployed. Set `E2E_SSH_HOST` and `E2E_SSH_REPO`. When either is unset, those log steps fail and name the missing setting. No host is built in.

Created names start with "E2E ". A failed or blocked step exits non-zero.
