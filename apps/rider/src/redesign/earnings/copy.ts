/**
 * The Earnings tab's state copy, word for word from the EA boards (Main, Activity, EntryDetail,
 * Payouts, PayoutDetail, PayoutStates). Screen-specific; the shared fallback stays in
 * `data/errors.ts`.
 */

export interface StateCopy {
  title: string;
  body: string;
  action?: string;
}

/** 403 ACCOUNT_NOT_ACTIVE (Earnings-not-active, Activity-not-active, Payouts-not-active, Payout-not-active). */
const PAUSED_BODY_SCREEN =
  "You can finish a delivery you've already started, but you won't get new offers. Money you've earned is always paid out on the Monday payouts. Account shows why your account is paused and what to do next.";
const PAUSED_BODY =
  'You can finish a delivery you’ve already started, but you won’t get new offers. Money you’ve earned is always paid out on the Monday payouts. Account shows why your account is paused and what to do next.';

export const PAUSED = {
  summary: { title: "Your account is paused, so earnings can't be shown", body: PAUSED_BODY_SCREEN, action: 'Go to Account' },
  activity: { title: "Your account is paused, so earnings activity can't be shown", body: PAUSED_BODY_SCREEN, action: 'Go to Account' },
  payouts: { title: 'Your account is paused, so payouts can’t be shown', body: PAUSED_BODY, action: 'Go to Account' },
  payout: { title: 'Your account is paused, so this payout can’t be shown', body: PAUSED_BODY, action: 'Go to Account' },
} satisfies Record<string, StateCopy>;

export const RATE_LIMITED_TITLE = 'Too many tries in a row';
export const RATE_LIMITED_WAIT = 'You can try again in 30 seconds.';

export const SUMMARY = {
  loading: 'Loading your earnings',
  error: {
    title: "We couldn't load your earnings",
    body: "Your earnings are safe. Your earnings summary couldn't reach HalalGoes. Try again in a moment. Payouts and your history are below.",
    action: 'Try again',
  },
  rateLimited: {
    title: RATE_LIMITED_TITLE,
    body: 'Your earnings are safe. Your earnings summary just needs a short pause. Payouts and your history are below.',
    action: 'Try again',
  },
  firstRun: {
    title: 'No earnings yet',
    body: 'Your earnings show here after your first delivery, with the delivery fee and the tip of each job.',
    more: 'Payouts go out every Monday once your earnings are available and your payout account is set up. There is no minimum.',
    action: 'Go to Home',
  },
  offline: (at: string) => ({
    title: "You're offline",
    body: `These are your earnings as saved at ${at}. They update when you're back online.`,
  }),
  backOnline: {
    title: "You're back online",
    body: 'Updating your earnings. The saved numbers below stay until the new ones arrive.',
  },
  slotError: {
    title: 'Couldn’t check your payouts',
    body: 'If a payout is on hold or didn’t go through, it shows here once your payouts load. Try again under Next payout.',
  },
  nextFailed: "Couldn't load your next payout",
  schedule: 'Weekly, every Monday. No minimum.',
  pendingLine: 'Includes pending lines',
  footnote: 'You get the full delivery fee the customer paid, plus every tip.',
};

export const ACTIVITY = {
  loading: 'Loading earnings activity',
  empty: {
    title: 'No earnings activity yet',
    body: 'Each delivery, tip and adjustment shows here as its own line. A delivery line shows its delivery fee and tip. Go online from Home to get offers.',
    action: 'Go to Home',
  },
  error: { title: "We couldn't load your earnings activity", body: 'Your earnings are safe. Try again in a moment.', action: 'Try again' },
  rateLimited: { title: RATE_LIMITED_TITLE, body: 'Your earnings are safe.', action: 'Try again' },
  offline: (at: string) => ({
    title: "You're offline",
    body: `These lines are as saved at ${at}. Statuses update when you're back online.`,
  }),
  more: 'Show older lines',
  loadingMore: 'Loading older lines',
  moreError: { title: "We couldn't load older lines", body: 'The lines above are up to date.', action: 'Try again' },
  end: "That's all your earnings activity.",
  pending: "New lines stay Pending for about an hour after the job started, or longer if something about it is being checked. Then they're Available for the next Monday payout.",
};

export const PAYOUTS = {
  loading: 'Loading payouts',
  error: { title: 'We couldn’t load your payouts', body: 'Your money is safe with HalalGoes and Stripe. Try again in a moment.', action: 'Try again' },
  offline: {
    title: 'You’re offline',
    body: 'Payouts load when you’re back online. Nothing is lost: your money is safe with HalalGoes and Stripe.',
    action: 'Try again',
  },
  rateLimited: {
    title: RATE_LIMITED_TITLE,
    body: 'Your money is safe with HalalGoes and Stripe. This screen just needs a short pause.',
    action: 'Try again',
  },
  savedOffline: (at: string) => ({
    title: "You're offline",
    body: `These payouts are as saved at ${at}. They update when you're back online.`,
  }),
  empty: {
    title: 'No payouts yet',
    body: 'Payouts go out every Monday once your earnings are available and your payout account is set up. There is no minimum.',
    more: 'Go online from Home to get offers.',
    action: 'Go to Home',
  },
  firstPayout: {
    title: 'No payouts yet',
    body: (date: string | null) =>
      date
        ? `Your first payout goes out ${date}. It holds the lines that are available by then; you can see each one in Earnings activity.`
        : 'Your first payout goes out on the Monday after your first lines are available.',
    more: 'Payouts go out every Monday. There is no minimum.',
    action: 'See earnings activity',
    /** The summary card's line above the empty state (EA Payouts-first-payout `SUM.firstpayout`). */
    noNext: (date: string | null) =>
      date ? `Your first payout goes out ${date}.` : 'Your first payout goes out on the Monday after your first lines are available.',
  },
  heading: 'Past and upcoming payouts',
  pendingLine: "Includes lines still pending. Pending lines go into a later payout once they're available.",
  schedule: 'Weekly, every Monday. No minimum. Paid out through Stripe.',
  more: 'Show older payouts',
  loadingMore: 'Loading older payouts',
  moreOffline: "Older payouts load when you're back online.",
  moreError: { title: "We couldn't load older payouts", body: 'The payouts above are up to date.', action: 'Try again' },
  end: "That's every payout so far.",
};

export const PAYOUT = {
  loading: 'Loading this payout',
  error: { title: 'We couldn’t load this payout', body: 'Your money is safe with HalalGoes and Stripe. Try again in a moment.', action: 'Try again' },
  offline: {
    title: 'You’re offline',
    body: 'This payout loads when you’re back online. Your money is safe with HalalGoes and Stripe.',
    action: 'Try again',
  },
  rateLimited: {
    title: RATE_LIMITED_TITLE,
    body: 'Your money is safe with HalalGoes and Stripe. This screen just needs a short pause.',
    action: 'Try again',
  },
  notFound: { title: 'We can’t find this payout', body: 'The link may be out of date. Your payouts list always shows the latest.', action: 'Go to Payouts' },
  linesHeading: "What's in this payout",
  linesNote: 'The amount above is exactly these lines, added up by HalalGoes.',
  noLines: {
    title: "We can't show the lines in this payout right now.",
    body: 'The amount above is still exactly what this payout holds. Your earnings activity shows every line.',
    action: 'Go to Earnings activity',
  },
  returned: {
    title: (n: number) => `Where the ${n} lines are now`,
    body: 'These lines are back in your balance and go into the next payout.',
    action: 'See them in Earnings activity',
  },
  fix: 'Fix payout account in Stripe',
  heldLine: 'When the hold is lifted, this shows Scheduled.',
  noDate: 'Goes out on the next Monday payout.',
};

export const LINE = {
  pending: 'Pending for about an hour after the job started, or longer if something about it is being checked.',
  tipsInFull: 'Tips reach you in full. HalalGoes takes nothing from a tip.',
  footnote: 'You get the full delivery fee the customer paid, plus every tip.',
  formula: (v: number) => `Worked out by HalalGoes, formula version ${v}. The app never calculates pay.`,
  notYet: 'Not in a payout yet. Once it is available, it goes into the next Monday payout.',
  clawNotYet: 'Not in a payout yet. A correction is settled against your earnings; see Earnings activity.',
  reversedNo: 'This line won’t be paid out. The correction that offsets it is in Earnings activity.',
  payoutLoading: 'Loading the payout for this line',
  payoutError: { title: "We couldn't load the payout for this line", body: 'This line is in a payout. The amount above is not affected.', action: 'Try again' },
  payoutMissing: { title: "In a payout we can't show right now", body: 'Your payouts list always shows the latest.', action: 'Go to Payouts' },
};

/** Banner copy shared by Earnings and Payouts (EA/Main, EA/Payouts `A`). */
export const BANNERS = {
  fix: 'Fix in Stripe',
  seePayout: 'See this payout',
  reasonLabel: 'Reason given:',
  stripeLabel: 'Details from Stripe:',
  needsAttention: 'Stripe says your payout account needs attention.',
  held: {
    title: 'This payout is on hold',
    line: (period: string) =>
      `Payout for ${period}. Once the hold is lifted, it goes out on the next Monday payout. Your earnings are safe.`,
  },
  failed: {
    title: 'This payout didn’t go through',
    line: (period: string, next: string | null) =>
      `Payout for ${period}. The money is back in your balance and goes into the ${next ? `${next} payout` : 'next Monday payout'}.`,
  },
  multi: {
    title: 'Two payouts need attention',
    line: (held: string, failed: string) => `${held} is on hold, and ${failed} didn’t go through.`,
    fixLine: 'Stripe says your payout account needs attention. Fix it first; each payout below gives its own reason.',
  },
  paused: {
    title: 'Payouts are paused',
    lines: (next: string | null) => [
      'Stripe needs more information before it can send your payouts.',
      'You can keep going online and taking deliveries. Your earnings keep adding up and are paid out once this is done.',
      ...(next ? [`Your payout on ${next} is held until then.`] : []),
    ],
    follower: (next: string | null) =>
      next
        ? `The same fix clears this too. Your payout on ${next} is held until then. You can keep taking deliveries.`
        : 'The same fix clears this too. You can keep taking deliveries.',
  },
  due: {
    title: (deadline: string | null) => (deadline ? `Stripe needs more information by ${deadline}` : 'Stripe needs more information'),
    line: (deadline: string | null) =>
      deadline
        ? `Your payouts keep going until then. After ${deadline}, payouts pause until it is done. You can keep taking deliveries either way.`
        : 'You can keep taking deliveries either way.',
  },
};

/** "Right now" / summary card words (EA/Main `B`, EA/Payouts `SUM`). */
export const NEXT = {
  soFar: 'so far',
  readyNote: 'Scheduled. The week has closed, so no more lines join this payout.',
  sendingNote: 'Sending to your Stripe account now.',
  heldNote: 'Held until your payout account is fixed.',
  fixFirstNote: 'Fix your payout account first, or this payout won’t go through either.',
  nothing: 'Nothing is waiting to be paid.',
  negative: 'No payout this Monday: there is nothing to send.',
  heldExtra: (period: string) =>
    `is on hold in the payout for ${period}. Once the hold is lifted, it goes out on the next Monday payout.`,
  heldExtraShort: (period: string) => `is on hold in the payout for ${period}.`,
  negativeCause: (date: string) =>
    `correction on ${date} was larger than your available earnings. The difference is carried forward and comes off your next earnings.`,
  neverBank: 'HalalGoes never takes money from your bank account.',
  seeCorrection: 'See this correction',
};
