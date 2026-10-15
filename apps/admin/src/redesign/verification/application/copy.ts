/** The workspace's page-level words, verbatim from `RV/App-*`. */
export const WORKSPACE = {
  notFound: { title: 'This application doesn’t exist', body: 'The link may be old or mistyped. Nothing was changed.', back: 'Back to applications' },
  loadError: { title: 'The application didn’t load', body: 'The server didn’t respond. Nothing was changed.' },
  blocked: (count: number) => (count === 1 ? 'Not approved: 1 thing stops approval' : `Not approved: ${count} things stop approval`),
  blockedBody: (until: string | null) =>
    `The server checked again when you pressed Approve. This page was out of date and now shows the current state. Nothing was approved${until ? ` and your claim is still held until ${until}` : ''}.`,
  alreadyDecided: {
    title: 'Already decided',
    body: 'This application already has a decision. Your decision wasn’t saved. The decision is shown below.',
  },
  claimLost: (name: string, endedAt: string | null) => ({
    title: 'Your claim ended',
    body: `Your claim on ${name}${endedAt ? ` ended at ${endedAt}` : ' ended'}, so the decision wasn’t saved. Nothing was changed. It went back to the queue in its place.`,
  }),
  goToQueue: 'Go to the queue',
} as const;
