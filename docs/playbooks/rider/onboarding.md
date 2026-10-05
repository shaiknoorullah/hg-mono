---
covers: []
reviewed: 2026-10-05
---

# Rider Playbook: Full Onboarding

A brand-new rider goes from a first phone sign-in to online and offerable through the real API, using the [dev world simulator](../../superpowers/specs/2026-09-28-devworld-harness-design.md#61-catalogue). `make dev-scenario s=onboard-rider` plays both sides. As the rider it signs in with a fresh number from the local fixed-code range, then submits the profile, a bicycle and the two documents a bicycle needs, sets up payouts and goes online. As `admin-seed` it approves each document and the application. The browser step then checks what the rider sees in the rider app.

The scenario writes no database row. Terminal commands run from `services/hg`.

---

## 0. Setup

1. **Setup command** (terminal): with the local stack up (`make up`, `make migrate`), reset the dev world:
   ```bash
   make dev-reset
   ```
2. **Setup command** (second terminal, `apps/rider`): the rider app on the web, against the local API. The API's local CORS list allows Expo on `:8081`, not the app's usual `:8083`.
   ```bash
   EXPO_PUBLIC_API_BASE_URL=http://localhost:8080 ./node_modules/.bin/expo start --web --port 8081
   ```
3. **Visible assertion**:
   - `make dev-reset` ends with `personas 20 ok`.
   - `http://localhost:8081` shows **Rider sign in** with a **Phone number** field.

---

## 1. Onboard

1. **Setup command** (terminal):
   ```bash
   make dev-scenario s=onboard-rider
   ```
2. **Visible assertion** (terminal), in this order:
   - `signed in  new rider +155501001NN`, a number from `+15550100160` to `+15550100199` that no rider has used since the reset. Then `state  PHONE_VERIFIED  (signed in)`.
   - `state  VEHICLE_PENDING  (profile)`, then `state  DOCUMENTS_PENDING  (vehicle: bicycle)`.
   - `document  GOVERNMENT_ID  uploaded and attached`, `document  PROFILE_PHOTO  uploaded and attached`, then `state  DOCUMENTS_REVIEW  (documents submitted)`.
   - `admin  approved GOVERNMENT_ID`, `admin  approved PROFILE_PHOTO`, `admin  application approved`, then `state  PAYOUT_PENDING  (application approved)`.
   - `connect  account acct_fake_…  payouts_enabled true`, then `state  ACTIVE  (payout account)`.
   - `online  the new rider is online beside bismillah-grill`.
   - `done  rider <id> is ACTIVE and online; sign in on the rider app with +155501001NN and code 000000`, and the command exits 0.

---

## 2. Sign In As The New Rider

1. **Browser action** (`http://localhost:8081`):
   - Type the number from the `done` line in **Phone number** and press **Send code**.
   - Type `000000` in **Verification code** and press **Verify**.
2. **Visible assertion**:
   - **Your shift** shows `Yusuf Onboard`, the number, `Not yet rated`, `Online — idle` and `Account active`.
   - The vehicle reads `BICYCLE`.

---

## Stripe test mode

Payout set-up with and without a Stripe test key works as in the [restaurant playbook's Stripe test mode](../restaurant/onboarding.md#stripe-test-mode). For a rider, when `account.updated` arrives the rider becomes `ACTIVE`; go online from the rider app's **Availability** screen.
