/**
 * Payout sent: the weekly payout reached the partner's bank account provider.
 *
 * `Amount` arrives already formatted from integer cents by the Go service
 * (money is int64 minor units everywhere: AGENTS.md "Non-negotiable
 * invariants" #3), and `SentAt` in 12-hour time (docs/decisions/README.md,
 * "Time format"). A template never does arithmetic.
 */
import { Layout, Note, P } from '../components/Layout.js';
import { defineTemplate } from '../define.js';

/** The notice that a payout left for the restaurant or rider. */
export const payoutSent = defineTemplate({
  name: 'payout_sent',
  vars: ['PayeeName', 'Amount', 'PeriodText', 'SentAt'] as const,
  subject: (v) => `HalalGoes sent you ${v.Amount}`,
  render: (v) => (
    <Layout preview={`Your payout of ${v.Amount} for ${v.PeriodText} is on its way.`} heading="Your payout is on its way">
      <P>We sent a HalalGoes payout. It can take a few business days to show in your bank account.</P>
      <Note label="Payout">
        {v.Amount} to {v.PayeeName}
        <br />
        For {v.PeriodText}
        <br />
        Sent {v.SentAt}
      </Note>
      <P muted>You can see this payout, and the orders in it, under Payouts in HalalGoes.</P>
    </Layout>
  ),
});
