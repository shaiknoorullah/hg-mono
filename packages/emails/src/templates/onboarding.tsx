/**
 * Application decisions: an admin approved a restaurant or rider, asked for
 * changes, or turned the application down
 * (docs/spec/05-admin.md, restaurant and rider application review).
 *
 * The admin's reason is sent verbatim (contract: RestaurantDecisionInput and
 * RiderDecisionInput, `reason_text`); the internal note never is. Approval is
 * told in words, never in green: solid green belongs to the halal seal alone
 * (AGENTS.md "Non-negotiable invariants" #10).
 */
import { Action, Layout, Note, P } from '../components/Layout.js';
import { defineTemplate } from '../define.js';

/** A restaurant application was approved. */
export const restaurantApplicationApproved = defineTemplate({
  name: 'restaurant_application_approved',
  vars: ['RestaurantName', 'ReasonText', 'ActionURL'] as const,
  subject: (v) => `${v.RestaurantName} is approved on HalalGoes`,
  render: (v) => (
    <Layout
      preview={`Your application for ${v.RestaurantName} is approved. Sign in to see what is left before you go live.`}
      heading="Your application is approved"
    >
      <P>
        We checked the documents and halal certificate for {v.RestaurantName}, and your application
        is approved.
      </P>
      <Note label="Note from the HalalGoes team">{v.ReasonText}</Note>
      <P>
        Approval does not put you live yet. Sign in to see what is left before customers can order
        from you, starting with setting up payouts.
      </P>
      <Action href={v.ActionURL}>See your next steps</Action>
    </Layout>
  ),
});

/** A restaurant application needs changes before approval. */
export const restaurantApplicationChangesRequested = defineTemplate({
  name: 'restaurant_application_changes_requested',
  vars: ['RestaurantName', 'ReasonText', 'ActionURL'] as const,
  subject: (v) => `${v.RestaurantName}: changes needed on your HalalGoes application`,
  render: (v) => (
    <Layout
      preview={`We need a few changes before we can approve ${v.RestaurantName}.`}
      heading="Your application needs changes"
    >
      <P>
        We reviewed the application for {v.RestaurantName}. Before we can approve it, we need you
        to change a few things.
      </P>
      <Note label="What to change">{v.ReasonText}</Note>
      <Action href={v.ActionURL}>Update your application</Action>
      <P muted>When you send the changes, we review the application again.</P>
    </Layout>
  ),
});

/** A restaurant application was turned down. */
export const restaurantApplicationRejected = defineTemplate({
  name: 'restaurant_application_rejected',
  vars: ['RestaurantName', 'ReasonText', 'ActionURL'] as const,
  subject: (v) => `Your HalalGoes application for ${v.RestaurantName}`,
  render: (v) => (
    <Layout
      preview={`We could not approve ${v.RestaurantName} on HalalGoes.`}
      heading="We could not approve your application"
    >
      <P>We reviewed the application for {v.RestaurantName}, and we cannot approve it.</P>
      <Note label="Why">{v.ReasonText}</Note>
      <P>You can still sign in to see your application and its documents.</P>
      <Action href={v.ActionURL}>Open your application</Action>
    </Layout>
  ),
});

/** A rider application was approved. */
export const riderApplicationApproved = defineTemplate({
  name: 'rider_application_approved',
  vars: ['FirstName', 'ReasonText'] as const,
  subject: () => 'You are approved to deliver with HalalGoes',
  render: (v) => (
    <Layout
      preview="Your rider application is approved. Set up payouts in the app to start delivering."
      heading="You are approved to deliver"
    >
      <P>Hi {v.FirstName},</P>
      <P>We checked your documents, and your application to deliver with HalalGoes is approved.</P>
      <Note label="Note from the HalalGoes team">{v.ReasonText}</Note>
      <P>
        Open the HalalGoes rider app and set up payouts. Once that is done, you can go online and
        take deliveries.
      </P>
    </Layout>
  ),
});

/** A rider application needs changes before approval. */
export const riderApplicationChangesRequested = defineTemplate({
  name: 'rider_application_changes_requested',
  vars: ['FirstName', 'ReasonText'] as const,
  subject: () => 'Changes needed on your HalalGoes rider application',
  render: (v) => (
    <Layout
      preview="We need a few changes before we can approve your rider application."
      heading="Your application needs changes"
    >
      <P>Hi {v.FirstName},</P>
      <P>We reviewed your application to deliver with HalalGoes. Before we can approve it, we need you to change a few things.</P>
      <Note label="What to change">{v.ReasonText}</Note>
      <P>Open the HalalGoes rider app to make the changes. We review your application again when you send them.</P>
    </Layout>
  ),
});

/** A rider application was turned down. */
export const riderApplicationRejected = defineTemplate({
  name: 'rider_application_rejected',
  vars: ['FirstName', 'ReasonText'] as const,
  subject: () => 'Your HalalGoes rider application',
  render: (v) => (
    <Layout
      preview="We could not approve your rider application."
      heading="We could not approve your application"
    >
      <P>Hi {v.FirstName},</P>
      <P>We reviewed your application to deliver with HalalGoes, and we cannot approve it.</P>
      <Note label="Why">{v.ReasonText}</Note>
    </Layout>
  ),
});
