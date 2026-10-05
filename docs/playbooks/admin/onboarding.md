---
covers: []
reviewed: 2026-10-05
---

# Admin Playbook: Onboarding A New Admin

A new admin goes from invitation to signed in through the real API, using the [dev world simulator](../../superpowers/specs/2026-09-28-devworld-harness-design.md#61-catalogue). `make dev-scenario s=onboard-admin` plays both sides:
- As `admin-seed`, a super admin, it invites the new admin.
- As the invitee, it opens the emailed invitation link and sets up the authenticator from it (`startInviteTotpEnrolment`).
- Still as the invitee, it sets the first password, confirmed with the first code (`resetPassword` with `totp_code`), then signs in with the password and the next code.

A staff role cannot hold a session without an authenticator, so this is the whole path a new admin has ([#170](https://github.com/shaiknoorullah/hg-mono/issues/170)).

The scenario writes no database row. It reads one value from the local database: the invitation link, which the local API logs instead of sending. Terminal commands run from `services/hg`.

---

## 0. Setup

1. **Setup command** (terminal): with the local stack up (`make up`, `make migrate`), reset the dev world:
   ```bash
   make dev-reset
   ```
2. **Setup command** (second terminal, `apps/admin`): the admin console against the local API.
   ```bash
   VITE_API_BASE_URL=http://localhost:8080 ./node_modules/.bin/vite
   ```
3. **Visible assertion**:
   - `make dev-reset` ends with `personas 20 ok`.
   - `http://localhost:5175` shows **Admin sign in**, with **Email**, **Password** and a six-digit **Authenticator code**.

---

## 1. Invite And Accept

1. **Setup command** (terminal):
   ```bash
   make dev-scenario s=onboard-admin
   ```
2. **Visible assertion** (terminal), in this order:
   - `invited  onboard-admin-XXXXXXXX@devworld.test  as ADMIN`.
   - `login before accepting  refused  http 401 INVALID_CREDENTIALS`.
   - `authenticator  enrolment started from the invitation link`.
   - `accepted  first password set and authenticator confirmed with the first code`.
   - `signed in  with password and authenticator code`, then `admin  the new admin reads the restaurant review queue`.
   - `done  onboard-admin-XXXXXXXX@devworld.test is an ADMIN who can sign in with password Devworld!Onboard2026; make dev-totp email=… prints the current code`, and the command exits 0.

---

## 2. Sign In As The New Admin

1. **Setup command** (terminal): the current code. The command prints only the code and the seconds left, never the secret.
   ```bash
   make dev-totp email=onboard-admin-XXXXXXXX@devworld.test
   ```
2. **Browser action** (`http://localhost:5175`):
   - Enter the email, `Devworld!Onboard2026` and the code, then press **Sign in**. If fewer than 5 seconds are left on the code, wait for the next one.
3. **Visible assertion**:
   - The console opens on the **Restaurant onboarding queue**. The navigation shows Restaurants, Riders, Orders, Live map, Refunds & disputes, System and Staff.

---

## What the console does not do yet

The console's `/accept-invite` page still sets only the password, and says the inviting super admin will set the authenticator up. Until it adopts `startInviteTotpEnrolment` (#170), an invitee accepting in the browser cannot finish alone; this scenario is the end-to-end path.
