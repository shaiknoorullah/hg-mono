/**
 * Halal certificate renewal reminders (30, 14, 7 and 1 days before expiry) and
 * the notice that a certificate lapsed.
 *
 * Schedule: docs/decisions/README.md, "Certificate renewal reminders to
 * restaurants". What a lapse does: docs/spec/01-platform.md — the daily job
 * moves an expired certificate to EXPIRED and the restaurant leaves every
 * listing until a renewed certificate is approved.
 *
 * Colour: an upcoming expiry uses the design system's halal "expiring" tint; a
 * lapse uses its cool slate, which reads "we can't currently vouch". Never red
 * for a halal state (AGENTS.md "Non-negotiable invariants" #9): red reads as
 * haram, a ruling HalalGoes does not make. The copy says the same thing: an
 * expired certificate is a paperwork state, not a verdict on the food.
 */
import { Action, Layout, Note, P } from '../components/Layout.js';
import { defineTemplate } from '../define.js';

/** The reminder sent 30, 14, 7 and 1 days before a halal certificate expires. */
export const certificateRenewalReminder = defineTemplate({
  name: 'certificate_renewal_reminder',
  vars: ['RestaurantName', 'IssuerName', 'ExpiresOn', 'TimeLeft', 'ActionURL'] as const,
  subject: (v) => `Your halal certificate expires ${v.TimeLeft}`,
  render: (v) => (
    <Layout
      preview={`Upload your renewed halal certificate so ${v.RestaurantName} stays listed.`}
      heading={`Your halal certificate expires ${v.TimeLeft}`}
    >
      <Note tone="expiring" label="Halal certificate">
        Issued by {v.IssuerName}
        <br />
        Expires {v.ExpiresOn}
      </Note>
      <P>
        To keep {v.RestaurantName} listed on HalalGoes, upload your renewed certificate before it
        expires. We review it before it replaces the current one.
      </P>
      <P>
        If the certificate expires before a renewed one is approved, customers stop seeing{' '}
        {v.RestaurantName} the day after it expires, until we approve the new certificate.
      </P>
      <Action href={v.ActionURL}>Upload renewed certificate</Action>
    </Layout>
  ),
});

/** The notice that a halal certificate expired and the restaurant is hidden. */
export const certificateLapsed = defineTemplate({
  name: 'certificate_lapsed',
  vars: ['RestaurantName', 'IssuerName', 'ExpiredOn', 'ActionURL'] as const,
  subject: (v) => `${v.RestaurantName} is hidden until your halal certificate is renewed`,
  render: (v) => (
    <Layout
      preview={`Your halal certificate expired, so ${v.RestaurantName} is hidden from customers for now.`}
      heading="Your halal certificate has expired"
    >
      <Note tone="expired" label="Halal certificate">
        Issued by {v.IssuerName}
        <br />
        Expired {v.ExpiredOn}
      </Note>
      <P>
        Because we can no longer vouch for {v.RestaurantName}'s halal certification, it is hidden
        from customers and cannot take new orders. Orders already accepted still complete.
      </P>
      <P>
        Upload your renewed certificate. As soon as we approve it, {v.RestaurantName} is listed
        again.
      </P>
      <Action href={v.ActionURL}>Upload renewed certificate</Action>
    </Layout>
  ),
});
