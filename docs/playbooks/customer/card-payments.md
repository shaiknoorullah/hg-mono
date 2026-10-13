---
covers: []
reviewed: 2026-10-05
---

# Customer Playbook: Paying with Stripe Test Cards

This playbook tests card payment at checkout, on the web build and on iOS or Android, against Stripe's test mode. The card is only authorised when the customer pays; the API captures it when the restaurant accepts and voids it on reject or timeout ([P-16](../../spec/01-platform.md#p-16--paymentintent-lifecycle-and-capture-timing)).

---

## 1. Configuration

Use the test-mode keys of one Stripe account. Never commit a key.

| Variable | Where | Value |
|---|---|---|
| `HG_STRIPE_SECRET_KEY` | the API's environment (`services/hg/.env`, or `deploy/.env` for the compose stack) | `sk_test_…` |
| `HG_STRIPE_WEBHOOK_SECRET` | the API's environment | `whsec_…` from the webhook endpoint, or from `stripe listen` (section 4). Optional on a laptop |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `apps/customer/.env` (copied from `.env.example`), or the shell that starts Expo | `pk_test_…` from the same account |

- With no `HG_STRIPE_SECRET_KEY` and `HG_ENV=local`, the API uses its fake gateway: orders are authorised at once and the app shows no card form.
- With no publishable key, the app still runs. Checkout says `Card payments aren't available right now. Please try again later.` (the console logs that `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is missing), keeps the order, and offers **Retry payment**.
- Restart Expo after changing an `EXPO_PUBLIC_` variable: it is bundled at build time.

## 2. Test cards

Any future expiry date, any CVC and any postal code.

| Card | What happens |
|---|---|
| `4242 4242 4242 4242` | Authorised |
| `4000 0025 0000 3155` | Asks for 3-D Secure; **Complete** authorises, **Fail** declines |
| `4000 0000 0000 0002` | Declined |

## 3. Pay at checkout

1. **Action**: Start the API with the test keys, and the customer app (`pnpm --filter @hg/customer web`, or a development build on a device). Sign in, fill a cart, open **Checkout** and press **Place order**.
2. **Visible assertion**:
   - Web: a sheet titled **Pay by card** opens with Stripe's card form and a **Stripe test mode** note listing the cards above.
   - iOS and Android: Stripe's payment sheet opens.
3. **Action**: Pay with `4242 4242 4242 4242`.
4. **Visible assertion**: The app opens tracking, and the order shows as waiting for the restaurant (`RESTAURANT_PENDING`).
5. **Action**: Place another order and pay with `4000 0000 0000 0002`.
6. **Visible assertion**: The sheet closes, checkout shows **Payment not completed** with Stripe's decline message and **Retry payment**. Retrying pays for the same order; no second order is created.
7. **Action**: Place another order, pay with `4000 0025 0000 3155` and complete the challenge.
8. **Visible assertion**: As in step 4. Closing the sheet instead shows `Payment was cancelled. Your order is not placed until you pay.`

## 4. How the order moves on without a webhook

Stripe cannot reach `localhost`, so on a laptop no webhook arrives. After the card is confirmed, the app reads `GET /v1/orders/{orderId}/payment`. While the stored payment is still before authorisation, that read asks Stripe for the PaymentIntent and applies the same transition the webhook would: an authorised card moves the order from `CREATED` to `RESTAURANT_PENDING`. In production the webhook still arrives and changes nothing that the read already did.

To exercise the real webhook path locally instead, forward Stripe's test events with the [Stripe CLI](https://docs.stripe.com/stripe-cli):

```bash
stripe login
stripe listen --forward-to localhost:8080/v1/webhooks/stripe
```

Copy the `whsec_…` it prints into `HG_STRIPE_WEBHOOK_SECRET` and restart the API. Each payment then also logs `payment_intent.*` events delivered with status 200.

## 5. Capture and void

1. **Action**: Accept the order in the restaurant app.
2. **Visible assertion**: In the Stripe dashboard (test mode) the payment changes from **Uncaptured** to **Succeeded**.
3. **Action**: Reject another authorised order instead.
4. **Visible assertion**: Its payment shows **Canceled**; nothing was charged.
