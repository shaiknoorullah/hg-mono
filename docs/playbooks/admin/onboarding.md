---
covers: []
reviewed: 2026-10-09
---

# Admin Playbook: Onboarding A New Admin

A new admin goes from invitation to signed in through the real API, using the [dev world simulator](../../superpowers/specs/2026-09-28-devworld-harness-design.md#61-catalogue). `make dev-scenario s=onboard-admin` plays both sides:
- As `admin-seed`, a super admin, it invites the new admin.
- As the invitee, it opens the emailed invitation link, sets the first password (`resetPassword`) and signs in with the password alone.
- Still as the invitee, it turns two-step sign-in on (`enrollTotp`, then `verifyTotpEnrolment` with the first code) and signs in again with the password and the next code.

Two-step sign-in is opt-in for staff ([two-step sign-in is opt-in](../../decisions/README.md#settled--owner-decisions-2026-10-05), [#623](https://github.com/shaiknoorullah/hg-mono/pull/623)): a password-only session can use the console but cannot move money. Refund approvals and payout runs need a session signed in with an authenticator code, so the scenario turns it on as an explicit last step and ends with an admin who can move money.

The scenario writes no database row. It reads one value from the local database: the invitation link, which the local API logs instead of sending. Terminal commands run from `services/hg`.

---

## 0. Setup

1. **Setup command** (terminal): reset the dev world as in step 1 of the [rider playbook's setup](../rider/onboarding.md#0-setup).
2. **Setup command** (second terminal, `apps/admin`): the admin console against the local API.
   ```bash
   VITE_API_BASE_URL=http://localhost:8080 ./node_modules/.bin/vite
   ```
3. **Visible assertion**:
   - `make dev-reset` ends with `personas 20 ok`.
   - `http://localhost:5175` shows **Admin sign in**, with **Email**, **Password** and an optional six-digit **Authenticator code**.

---

## 1. Invite And Accept

1. **Setup command** (terminal):
   ```bash
   make dev-scenario s=onboard-admin
   ```
2. **Visible assertion** (terminal), in this order:
   - `invited  onboard-admin-XXXXXXXX@devworld.test  as ADMIN`.
   - `login before accepting  refused  http 401 INVALID_CREDENTIALS`.
   - `accepted  first password set from the invitation link`.
   - Sometimes `waited  Ns for the password reset's account revocation to lift`: a password reset blocks the account's new sessions until the API's next revocation refresh, at most 10 seconds.
   - `signed in  with the password alone (amr pwd: may not move money)`, then `admin  the new admin reads the restaurant review queue`.
   - `authenticator  two-step sign-in turned on and confirmed with the first code`.
   - `login without a code  refused  http 403 MFA_REQUIRED`.
   - `signed in  with password and authenticator code (amr pwd+totp: may move money)`.
   - `done  onboard-admin-XXXXXXXX@devworld.test is an ADMIN who can sign in with password Devworld!Onboard2026; make dev-totp email=… prints the current code`, and the command exits 0. The scenario waits up to 30 seconds for a fresh code before the last sign-in.

---

## 2. Sign In As The New Admin

1. **Setup command** (terminal): the current code. The command prints only the code and the seconds left, never the secret. It needs `HG_APP_DATA_KEY` set in `deploy/.env`, the key the API sealed the authenticator with.
   ```bash
   make dev-totp email=onboard-admin-XXXXXXXX@devworld.test
   ```
2. **Browser action** (`http://localhost:5175`):
   - Enter the email, `Devworld!Onboard2026` and the code, then press **Sign in**. If fewer than 5 seconds are left on the code, wait for the next one.
3. **Visible assertion**:
   - The console opens on the **Restaurant onboarding queue**. The navigation shows Restaurants, Riders, Orders, Live map, Refunds & disputes, System and Staff.

---

## What the console does not do yet

The console has no page to turn two-step sign-in on. An admin who accepts in the browser signs in with the password alone and can use the console, but cannot approve refunds or run payouts until two-step sign-in is on; this scenario is the way to turn it on locally.
