/**
 * Words on the refund screens, lifted from the boards (`REF/*`). Where a board stated a rule the
 * contract does not have (a support-only ban on goodwill, a client-side 24-hour limit, a fixed
 * second-approver amount), the sentence is written so it claims only what the server does.
 */

type Nothing = { title: string; body: string };

const NOTHING_CHARGED = 'Nothing was charged, so there is nothing to refund';

export const REFUND_COPY = {
  nothing: {
    rejected: {
      title: NOTHING_CHARGED,
      body: 'The restaurant rejected this order. The authorisation was voided, so the customer was never charged. Nothing can be refunded, and nothing needs to be. If the customer sees a pending charge, it is the voided hold; their bank removes it without a refund.',
    },
    cancelled: {
      title: NOTHING_CHARGED,
      body: 'This order was cancelled before the restaurant accepted it. The authorisation was voided, so the customer was never charged. Nothing can be refunded, and nothing needs to be.',
    },
    voided: {
      title: NOTHING_CHARGED,
      body: 'The authorisation on this order was voided, so the customer was never charged. Nothing can be refunded, and nothing needs to be.',
    },
    'payment-failed': {
      title: NOTHING_CHARGED,
      body: 'The payment for this order failed, so nothing was authorised or charged. There is nothing to refund. The customer saw the plain-language reason at checkout; the order page shows the provider’s codes.',
    },
    'nothing-captured': {
      title: 'Nothing captured yet, so there is nothing to refund',
      body: 'The payment is authorised but not charged yet: it is captured when the restaurant accepts. To stop the order, cancel it instead. The authorisation is voided and nothing is charged.',
    },
    'fully-refunded': {
      title: 'Everything captured has already been refunded',
      body: 'Everything captured on this order has already been refunded, so the server refuses another refund. Captured and refunded are the payment’s own totals from the server. The refund is listed on the order.',
    },
  } satisfies Record<string, Nothing>,
  paymentTotalsNote: 'Captured and refunded are the payment’s own totals from the server, shown on the order’s payment card.',

  chooseScope: 'Choose what to refund, then the reason.',
  scope: {
    full: 'Everything the customer paid that no other refund already covers. Calculated by the server from the order.',
    items: 'Choose lines and quantities.',
    goodwill: 'A typed amount, as a gesture.',
    fees: 'Delivery and service fees, not the food.',
    feesOff: 'The staff refund route has no Fees only scope yet.',
  },
  itemsNote: 'How many of each line are already refunded isn’t shown yet. If a line is already covered, the server refuses and says which.',
  goodwillNote: 'Dollars and cents, sent as whole cents. A larger goodwill refund goes to a second person for approval, and nothing moves until they approve.',
  reasonNote: 'Who bears the refund is set by the server from the reason.',
  halalEvidenceOff:
    'Not available yet: a staff refund has no field for whether the concern is backed up, so the server charges the restaurant the item’s net price whatever is chosen here.',
  amountServer: 'Calculated by the server from the order when you issue it. You see it, and who bears it, straight after. Nothing is sent from this page as an amount.',
  amountGoodwill: 'The amount you enter, in whole cents. The server still checks it against what was captured.',

  running:
    'This order is still being prepared. If the kitchen can’t finish, it cancels automatically and the customer is refunded in full, so don’t refund for lateness now. Refund here only for something that has already gone wrong, like a duplicate charge.',
  disputed: 'Pick what went wrong. Resolving the dispute is a separate step, and refunding doesn’t close it.',

  reviewIntro:
    "Money moves as soon as you issue it, unless it's above your limit; then it goes to a second person and nothing moves yet. A refund can't be undone.",
  reviewNote: 'You review it here before anything is sent. Pressing twice, or retrying after an error, still issues one refund.',
  noPreview: 'The amount and who bears it can’t be shown before you issue: the server has no refund preview yet.',

  issuedNote:
    'The customer sees “Refund in progress” until the provider confirms. The amount and who bears it below are as the server sent them.',
  approvalNote:
    'Above your limit, or a goodwill refund that always needs a second person. No refund exists yet and the customer hasn’t been told anything. Your request is kept, so nothing is lost.',
  approvalSelf: 'You can’t approve your own request. Someone else with the right role does that.',

  timeout: 'We can’t tell yet whether the refund went through. Trying again sends the same request, so it can never refund twice.',
  mfa: 'Moving money needs a session signed in with an authenticator code. Nothing was changed and your draft is kept. Turn on two-step sign-in for your account, sign in again with the code, and come back to this draft.',
  exceeds:
    'The refunds on this order, with this one, would be more than was captured. Nothing was changed. Reload the order, check the payment’s captured and refunded totals, then lower the amount or choose different items.',
  notRefundable: 'The payment on this order changed while you were filling this in. Nothing was changed. Reload the order to see where it stands.',
  dailyCap: 'Nothing was changed. Ask another admin to issue this refund. Copy your notes so they don’t have to ask the customer again.',
  selfApproval: 'Another approver has to. Nothing was changed and the request stays pending for them.',
  keyReused: 'Nothing was changed. Close this panel and start the refund again.',
  alreadyRequested(lineNos: readonly number[], fees: boolean): string {
    const parts = [
      ...(lineNos.length > 0 ? [lineNos.length === 1 ? `line ${lineNos[0]}` : `lines ${lineNos.join(', ')}`] : []),
      ...(fees ? ['the delivery and service fees'] : []),
    ];
    const what = parts.length > 0 ? parts.join(' and ') : 'part of this request';
    return `Another refund, or a request waiting for approval, already covers ${what}. Nothing was changed. Each line and the fees can be refunded once.`;
  },
} as const;

export const PAGE = {
  title: 'Refunds',
  findHeading: 'Find the order',
  findIntro: 'Refunds are issued against one order. There is no refund without an order.',
  findHelp: 'Enter the order code from the customer’s receipt. Codes have no letters I, L, O or U. Searching by phone, email or name needs an API.',
  lookupIdle: 'Look up an order to see or issue refunds',
  lookupIdleBody: 'The order and its refunds appear here when the server answers.',
  notFound: (code: string) => `No order has the code ${code}`,
  notFoundBody: 'Check the code with the customer.',
  lookupErrorTitle: "The lookup didn't finish.",
  lookupErrorBody: 'This is not the same as “no order”. Nothing was changed.',
  offline: 'You’re offline. Nothing is searched or queued until you reconnect.',
  failedHeading: 'Failed refunds',
  failedIntro: 'Refunds the provider declined, newest first. A row stays after a replacement is issued.',
  failedEmptyTitle: 'No failed refunds',
  failedEmptyBody: 'Refunds the provider declined appear here, newest first.',
  failedErrorTitle: 'Failed refunds didn’t load',
  failedErrorBody: 'This doesn’t mean there are none. Nothing was changed.',
} as const;
