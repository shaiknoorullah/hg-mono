/**
 * Account standing: a restaurant or rider is suspended, or reinstated.
 *
 * The wording follows what suspension actually does
 * (docs/spec/03-restaurant.md, "R-36 — Account status, suspension,
 * reinstatement and in-flight orders": a status change stops the future, never
 * the present) and the decision that reinstating a paused rider notifies them
 * (docs/decisions/README.md, "Notifying a paused rider who is reinstated").
 */
import { Action, Layout, Note, P } from '../components/Layout.js';
import { defineTemplate } from '../define.js';

/** A restaurant was suspended. */
export const restaurantSuspended = defineTemplate({
  name: 'restaurant_suspended',
  vars: ['RestaurantName', 'ReasonText', 'ActionURL'] as const,
  subject: (v) => `${v.RestaurantName} is suspended on HalalGoes`,
  render: (v) => (
    <Layout
      preview={`${v.RestaurantName} is not taking new orders on HalalGoes for now.`}
      heading={`${v.RestaurantName} is suspended`}
    >
      <P>
        An admin suspended {v.RestaurantName} on HalalGoes. While it is suspended, customers cannot
        order from you and you do not receive new orders.
      </P>
      <Note label="Why">{v.ReasonText}</Note>
      <P>
        Orders you had already accepted still complete as normal. You can still sign in to see your
        orders, your earnings and your payouts, and to contact us to appeal. Payouts pause until the
        suspension is lifted; nothing you have earned is lost.
      </P>
      <Action href={v.ActionURL}>Sign in to HalalGoes</Action>
    </Layout>
  ),
});

/** A restaurant's suspension was lifted. */
export const restaurantReinstated = defineTemplate({
  name: 'restaurant_reinstated',
  vars: ['RestaurantName', 'ActionURL'] as const,
  subject: (v) => `${v.RestaurantName} is back on HalalGoes`,
  render: (v) => (
    <Layout
      preview={`${v.RestaurantName} can take orders on HalalGoes again.`}
      heading={`${v.RestaurantName} is back`}
    >
      <P>
        The suspension on {v.RestaurantName} is lifted. You can take orders on HalalGoes again,
        and paused payouts resume on the next payout run.
      </P>
      <Action href={v.ActionURL}>Open your dashboard</Action>
    </Layout>
  ),
});

/** A rider's account was paused. */
export const riderSuspended = defineTemplate({
  name: 'rider_suspended',
  vars: ['FirstName', 'ReasonText'] as const,
  subject: () => 'Your HalalGoes rider account is paused',
  render: (v) => (
    <Layout
      preview="You cannot go online to take deliveries for now."
      heading="Your rider account is paused"
    >
      <P>Hi {v.FirstName},</P>
      <P>
        An admin paused your HalalGoes rider account. While it is paused, you cannot go online or
        take new deliveries.
      </P>
      <Note label="Why">{v.ReasonText}</Note>
      <P>
        You can still open the rider app to see your earnings and payouts, and to contact us if you
        think this is a mistake.
      </P>
    </Layout>
  ),
});

/** A paused rider's account is active again. */
export const riderReinstated = defineTemplate({
  name: 'rider_reinstated',
  vars: ['FirstName'] as const,
  subject: () => 'You can deliver with HalalGoes again',
  render: (v) => (
    <Layout
      preview="Your rider account is active again. You can go online in the app."
      heading="You can deliver again"
    >
      <P>Hi {v.FirstName},</P>
      <P>
        Your HalalGoes rider account is active again. Open the rider app and go online whenever you
        are ready to take deliveries.
      </P>
    </Layout>
  ),
});
