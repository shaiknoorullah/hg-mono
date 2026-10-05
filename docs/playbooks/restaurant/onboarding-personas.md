---
covers: []
reviewed: 2026-10-05
---

# Restaurant Playbook: Onboarding Personas

This playbook tests the restaurant operator onboarding flow across every lifecycle state defined in the [dev world harness design](../../superpowers/specs/2026-09-28-devworld-harness-design.md). Each persona proves a specific screen and gating behavior against the real backend.

The reset also seeds a [Toronto catalogue](../../superpowers/specs/2026-09-28-devworld-harness-design.md#51a-toronto-catalogue) of live restaurants. Its owners sign in as `<slug>@seed.hg` with the same password. Their restaurants are already live, so they skip onboarding. You don't need to keep a restaurant console open for them to read open to customers: `make run` sends their heartbeat once a minute, and it leaves `paused` alone.

---

## 1. Unverified Email Gate (`fresh` persona)

Proves that an account created without email verification is blocked from proceeding to profile onboarding.

1. **Setup command** (terminal):
   ```bash
   # Reset or select the fresh persona
   cmd/devworld totp fresh
   ```
2. **Browser action**:
   - Open `/login`
   - Fill **Business email**: `fresh@seed.hg`
   - Fill **Password**: `Seed!2026`
   - Click **Sign in**
3. **Visible assertion**:
   - The sign-in form or gate displays a verification banner or alert indicating that email verification is required before onboarding can continue.

---

## 2. Profile Details Step (`profile` persona)

Proves the initial profile data entry screen where legal name, address, cuisine, and contact details are collected.

1. **Setup command**:
   ```bash
   cmd/devworld totp profile
   ```
2. **Browser action**:
   - Open `/login` and sign in as `profile@seed.hg` / `Seed!2026`
   - Navigate to `/onboarding`
3. **Visible assertion**:
   - Heading **Profile details** is visible.
   - Address fields (street line 1, city, province, postal code) and average preparation time input are editable.
   - The "Continue to documents" action button is disabled until required fields are filled.

---

## 3. KYC and Halal Documents Upload (`docs-todo` persona)

Proves document upload requirements: Business Licence, Food Safety Certificate, Owner ID, and Halal Certificate.

1. **Setup command**:
   ```bash
   cmd/devworld totp docs-todo
   ```
2. **Browser action**:
   - Sign in as `docs-todo@seed.hg` / `Seed!2026`
   - Land on `/onboarding` (step: Documents)
3. **Visible assertion**:
   - Document upload list shows 4 required categories.
   - Completed documents display an uploaded indicator; incomplete items display an upload zone.
   - Submit for review button remains disabled until all 4 documents are uploaded and confirmed.

---

## 4. Under Review Status (`docs-review` persona)

Proves the pending state while platform staff reviews compliance documents and the halal certificate.

1. **Setup command**:
   ```bash
   cmd/devworld totp docs-review
   ```
2. **Browser action**:
   - Sign in as `docs-review@seed.hg` / `Seed!2026`
   - Open `/onboarding`
3. **Visible assertion**:
   - Screen displays **Application under review**.
   - Explanatory copy explains that verification is in progress (Rule 8: silence is never consent).
   - Operational navigation tabs (Orders, Menu, Hours) remain locked or redirect to review status.

---

## 5. Rejected Documents Remediation (`docs-rejected` persona)

Proves the remediation flow when an admin rejects a document with a reason code.

1. **Setup command**:
   ```bash
   cmd/devworld totp docs-rejected
   ```
2. **Browser action**:
   - Sign in as `docs-rejected@seed.hg` / `Seed!2026`
   - Open `/onboarding`
3. **Visible assertion**:
   - An alert banner highlights the rejected document(s) with the reviewer's rejection note.
   - A replacement file upload control is rendered alongside the rejection reason.

---

## 6. Stripe Connect Payout Setup (`payout-todo` persona)

Proves the Stripe Connect onboarding handover step once documents are approved.

1. **Setup command**:
   ```bash
   cmd/devworld totp payout-todo
   ```
2. **Browser action**:
   - Sign in as `payout-todo@seed.hg` / `Seed!2026`
   - Open `/onboarding`
   - Click **Set up payouts**
3. **Visible assertion**:
   - Browser navigates to Stripe's hosted Express onboarding page or return handler.

---

## 7. Active Live Partner (`bismillah-grill` persona)

Proves that an approved, onboarded restaurant bypasses onboarding and lands directly on Live Orders.

1. **Setup command**:
   ```bash
   cmd/devworld totp bismillah-grill
   ```
2. **Browser action**:
   - Sign in as `owner@restaurant.ca` (or `bismillah-grill@seed.hg`)
   - Land on `/login` and submit
3. **Visible assertion**:
   - User is redirected to `/orders` immediately.
   - Heading **Live orders** is displayed with live queue controls and sidebar navigation.
