/** The queue's words, verbatim from the rider-onboarding boards (`Main` and its `Queue*` states). */
export const QUEUE = {
  caption: (filter: string) => `Rider applications: ${filter}`,
  takeNext: 'Take next',
  takeHelp: 'Claims the oldest unclaimed application for 60 minutes. Opening a row only reads it.',
  takeHelpTaking: 'Claiming the oldest application…',
  takeHelpNothing: 'Nothing waiting to take',
  takeHelpOffline: 'Paused while offline',
  takeHelpListDown: 'Take next still works while the list is unavailable',
  takeHelpLoading: 'Take next works while the list loads',
  continueReview: 'Continue review',
  tryAgain: 'Try again',
  showAll: 'Show all states',
  reset: 'Reset to Documents review',
  loading: 'Loading rider applications',
  notSubmitted: 'Not submitted yet',
  targetMissed: 'Target missed',
  decided: 'Decided',
  notInReview: 'Not in review',
  empty: { title: 'Nothing waiting for review', body: 'New applications appear here, oldest first, when a rider submits documents.' },
  filtered: (label: string) => ({ title: `No applications in ${label}`, body: 'No rider matches this state right now. Choose other states to see more.' }),
  error: { title: 'Rider applications didn’t load', body: 'The server didn’t respond. Nothing was claimed and your filter is kept.' },
  forbidden: {
    title: 'You don’t have access to rider applications',
    body: 'The server refused this list. Your role may have changed while you were signed in; if you think that’s wrong, ask a Super Admin.',
  },
  offline: { title: 'You’re offline. Take next is paused.', body: 'This list won’t update until the connection returns. Nothing you do now is queued or sent later.' },
  holding: (name: string, left: string) => ({
    title: `You have ${name} claimed, ${left}`,
    body: (endsAt: string) => `Your claim ends at ${endsAt} and can’t be extended. Continue where you left off.`,
  }),
  claimEnded: (name: string, endedAt: string) => ({
    title: `Your claim on ${name} ended at ${endedAt}`,
    body: `Nothing you hadn’t submitted was recorded. ${name} is back in the queue for anyone to take, including you.`,
  }),
  takeNull: { title: 'Nothing to take: no applications are waiting', body: 'Take next found nothing unclaimed in Documents review. New applications appear here, oldest first.' },
  allClaimed: (n: number) => ({
    title: `Nothing to take: the ${n === 1 ? 'waiting application is' : `${n} waiting applications are`} claimed by other reviewers`,
    body: (firstEnd: string | null) =>
      `Take next claims only unclaimed applications.${firstEnd ? ` The first claim ends at ${firstEnd}; try again then, or open a row to read it.` : ' Open a row to read it.'}`,
  }),
  takeFailed: { title: 'Take next didn’t work. Nothing was claimed.', body: 'The server didn’t answer. Trying again can’t claim two applications: the same request key is sent.' },
  takeHeld: (name: string, endsAt: string) => ({
    title: `You already have ${name} claimed`,
    body: `Take next opened your current claim instead of claiming a second one. Finish it, or let the claim end at ${endsAt}.`,
  }),
  loadMoreFailed: (n: number) => ({ title: 'More applications didn’t load.', body: `The ${n} above are still correct, oldest first. Nothing was claimed.` }),
} as const;
