/** The workspace's words, from the rider-onboarding boards (`DetailReview` and its `Detail*` modes). */
export const WORKSPACE = {
  notFound: { title: 'This application doesn’t exist', body: 'The link may be old or mistyped. Nothing was changed.', back: 'Back to rider applications' },
  loadError: { title: 'The application didn’t load', body: 'The server didn’t respond. Nothing was changed.' },
  forbidden: { title: 'You can’t open this application', body: 'The server refused it. Your role may have changed while you were signed in. Nothing was changed.' },
  loading: 'Loading the application',
  backToQueue: 'Back to rider applications',
  takeNext: 'Take next',
  unclaimed: {
    title: 'You’re reading without a claim. To decide, take it from the queue.',
    body: 'Take next gives you the oldest unclaimed application, which may not be this one.',
  },
  otherReviewer: (until: string) => ({
    title: `Claimed by another reviewer until ${until}`,
    body: 'You can read this application and open its documents. Deciding is off until the claim ends.',
  }),
  claimEnded: (endedAt: string) => ({
    title: `Your claim ended at ${endedAt}`,
    body: 'Anything you hadn’t submitted wasn’t recorded. Take next gives you the oldest unclaimed application, which may or may not be this one. Copy your notes first if you need them.',
  }),
  claimEnding: (mins: number) => ({
    title: `${mins} ${mins === 1 ? 'minute' : 'minutes'} left on your claim`,
    body: 'Claims can’t be extended. If it ends, nothing you haven’t submitted is recorded, and Take next gives you the oldest unclaimed application, which may not be this one.',
  }),
  offline: {
    title: 'You’re offline. Nothing can be recorded until the connection returns.',
    body: 'Your answers and note stay on this page. Nothing is queued or sent later. If you pressed a button just before the connection dropped, reload when you’re back to see whether it was recorded.',
  },
  decide403: {
    title: 'You can no longer decide rider applications. Nothing was recorded.',
    body: 'The server refused: your role changed while you held this claim. Copy your note if you need it, then ask a Super Admin to check your role.',
  },
  alreadyDecided: {
    title: 'Already decided',
    body: 'This application already has a decision. Your decision wasn’t sent and nothing was changed. The page shows the decision now.',
  },
  claimLost: (name: string) => ({
    title: 'Your claim ended',
    body: `Your claim on ${name} ended, so the decision wasn’t sent. Decisions on documents you already sent are saved. Nothing else was changed.`,
  }),
  precondition: {
    title: 'Not approved: something changed after you opened this page',
    body: 'The server checked again when you pressed Approve rider. This page now shows the current state. Nothing was approved and your claim is still held.',
  },
  age422: {
    title: 'Not approved: this rider is under 18',
    body: 'Riders must be 18 or older, and no one can override this. The page now shows what the server has. Nothing was changed.',
  },
  switched: (name: string) => ({ title: `Take next gave you ${name}’s application`, body: 'Take next claims the oldest unclaimed application, which was not the one you were reading.' }),
  takeEmpty: { title: 'Nothing to take: no applications are waiting', body: 'Take next found no unclaimed application in Documents review. New applications appear in the queue, oldest first.' },
  takeFailed: { title: 'Take next didn’t work', body: 'The server didn’t respond. Nothing was claimed. Try again.' },
  outcome: {
    approved: (name: string) => ({ title: `${name} is approved and now Payout pending`, body: 'They can’t take deliveries until payouts are set up and Stripe confirms them.' }),
    changes: (name: string) => ({ title: `Changes requested: the application is back with ${name}`, body: 'It moved to Documents rejected until the rider uploads again.' }),
    rejected: (name: string) => ({ title: `${name}’s application is rejected`, body: 'It moved to Documents rejected.' }),
  },
  copied: 'ID copied',
} as const;
