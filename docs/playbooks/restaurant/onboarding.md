---
covers: []
reviewed: 2026-10-05
---

# Restaurant Playbook: Full Onboarding

A brand-new restaurant goes from sign-up to taking orders through the real API, using the [dev world simulator](../../superpowers/specs/2026-09-28-devworld-harness-design.md#61-catalogue). `make dev-scenario s=onboard-restaurant` plays both sides. As the owner it signs up, confirms the email, fills the profile and hours, uploads and submits the documents, sets up payouts and adds the first menu item. As `admin-seed` it approves each document, runs the halal seven-check, approves the application and approves the menu item. The browser steps then check what the new owner sees.

The scenario writes no database row. It reads one value from the local database: the email-confirmation link, which the local API logs instead of sending.

Terminal commands run from `services/hg`. The browser is the restaurant console on `http://localhost:5183`.

---

## 0. Setup

1. **Setup command**: the same as step 1 of the [journey playbook's setup](journey.md#0-setup), which starts the stack, resets the dev world and starts the console.
2. **Visible assertion**:
   - The driver prints `backend (local) ready`, `dev world reset: personas 20 ok` and `vite up: http://localhost:5183`.

---

## 1. Onboard

1. **Setup command** (terminal):
   ```bash
   make dev-scenario s=onboard-restaurant
   ```
2. **Visible assertion** (terminal), in this order:
   - `registered  onboard-XXXXXXXX@devworld.test  restaurant <id>`, then `email verified from the emailed link`.
   - `state  PROFILE_PENDING  (signed in)`, then `state  DOCUMENTS_PENDING  (profile and hours)`.
   - `document  <type>  uploaded and attached` four times: `BUSINESS_LICENCE`, `FOOD_SAFETY`, `OWNER_ID`, `HALAL_CERTIFICATE`. Then `state  DOCUMENTS_REVIEW  (documents submitted)`.
   - `admin  approved <type>` for each document.
   - `admin  halal certificate passed all seven checks`, then `admin  application approved`, then `state  PAYOUT_PENDING  (application approved)`.
   - `connect  account acct_fake_…  payouts_enabled true`, then `state  MENU_PENDING  (payout account)`.
   - `state  MENU_PENDING  (menu item waiting for review)`: the first item is not live until an admin approves it.
   - `menu  first item approved by admin-seed`, then `state  ACTIVE  (menu approved)`.
   - `customer  amina sees Chicken Karahi on the menu`.
   - `done  <id> is ACTIVE; sign in at the restaurant console as onboard-XXXXXXXX@devworld.test / Devworld!Onboard2026`, and the command exits 0.

---

## 2. Sign In As The New Owner

1. **Browser action**:
   - Open `/login`. Sign in with the email and password from the `done` line.
2. **Visible assertion**:
   - The console opens on **Live orders** with the empty state `No live orders`. No onboarding step is left.

---

## 3. Menu

1. **Browser action**:
   - Open `/menu`.
2. **Visible assertion**:
   - Category **Mains** lists **Chicken Karahi**, `Tomato and ginger karahi.`, `$18.99`, **Available**.
   - There is no `Edit pending review` chip: the item was approved.

---

## 4. Payouts

1. **Browser action**:
   - Open `/payouts`.
2. **Visible assertion**:
   - **Payouts** shows `No payouts yet`. The payout account exists; no order has settled yet.

---

## Stripe test mode

With no `HG_STRIPE_SECRET_KEY` on the API, the local fake Stripe makes the payout account ready at once, as above.

With a Stripe **test** key (`sk_test_…`), Express onboarding is hosted by Stripe and needs a person:
1. The scenario stops after `connect  Stripe test-mode onboarding waits for a person: open <url>`, at `PAYOUT_PENDING`.
2. Run `stripe listen --forward-connect-to localhost:8080/v1/webhooks/stripe`. Open the URL and complete Stripe's test onboarding with Stripe's test data.
3. When `account.updated` arrives, the restaurant moves to `MENU_PENDING`.
4. Sign in as the new owner, add a menu item at `/menu`, and approve it in the admin console's menu review queue. The restaurant becomes `ACTIVE`.

A live key (`sk_live_…`) must never be used locally.
